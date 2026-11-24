use crate::http::{self, Request};
use crate::store::{AccountStore, Episode, StoreError, User};
use argon2::{
    password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString},
    Argon2, Params, Version,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use getrandom::getrandom;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::net::IpAddr;
use std::sync::{Arc, LazyLock, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

const SESSION_MAX_AGE: i64 = 30 * 24 * 60 * 60;
const DUMMY_HASH: &str = "$argon2id$v=19$m=19456,t=2,p=1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

static PASSWORD_LOCK: LazyLock<Mutex<()>> = LazyLock::new(|| Mutex::new(()));
static ARGON2: LazyLock<Option<Argon2<'static>>> = LazyLock::new(|| {
    Params::new(19 * 1024, 2, 1, Some(32))
        .ok()
        .map(|params| Argon2::new(Algorithm::Argon2id, Version::V0x13, params))
});

use argon2::Algorithm;

#[derive(Clone)]
pub struct AccountState {
    pub store: Option<Arc<AccountStore>>,
    limits: Arc<Mutex<RateLimits>>,
}

#[derive(Default)]
struct RateLimits {
    clients: HashMap<String, VecDeque<std::time::Instant>>,
    failed_users: HashMap<String, FailedUser>,
}

struct FailedUser {
    count: u32,
    last_failed: std::time::Instant,
}

struct Authenticated {
    user: User,
    token_hash: Vec<u8>,
}

#[derive(Debug)]
struct ApiError {
    status: &'static str,
    code: &'static str,
    message: &'static str,
    field: Option<&'static str>,
    retry_after: Option<u64>,
}

impl AccountState {
    pub fn new(store: Option<Arc<AccountStore>>) -> Self {
        Self {
            store,
            limits: Arc::new(Mutex::new(RateLimits::default())),
        }
    }
}

pub fn handle_request(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> bool {
    if !is_account_path(&request.path) {
        return false;
    }
    if request.method == "OPTIONS" {
        http::send_response(
            stream,
            "204 No Content",
            "text/plain",
            b"",
            false,
            Some("no-store"),
            false,
            &[],
        );
        return true;
    }
    // Checked for every state-changing request, with or without a body (sign-out and the
    // DELETE routes have none).
    if !origin_allowed(request) && matches!(request.method.as_str(), "POST" | "PUT" | "DELETE") {
        send_error(
            stream,
            head_only,
            ApiError {
                status: "403 Forbidden",
                code: "forbidden_origin",
                message: "Origin does not match Host",
                field: None,
                retry_after: None,
            },
        );
        return true;
    }
    if matches!(request.method.as_str(), "POST" | "PUT" | "DELETE")
        && !request.body.is_empty()
        && request
            .header("content-type")
            .is_none_or(|value| !value.to_ascii_lowercase().starts_with("application/json"))
    {
        send_error(
            stream,
            head_only,
            ApiError {
                status: "400 Bad Request",
                code: "invalid_input",
                message: "Content-Type must be application/json",
                field: Some("content-type"),
                retry_after: None,
            },
        );
        return true;
    }

    if state.store.is_none() {
        send_error(
            stream,
            head_only,
            ApiError {
                status: "503 Service Unavailable",
                code: "unavailable",
                message: "Account store is unavailable",
                field: None,
                retry_after: None,
            },
        );
        return true;
    }

    let result = dispatch(stream, request, state, head_only);
    if let Err(error) = result {
        if let Some((stream, error)) = error {
            send_error(stream, head_only, error);
        }
    }
    true
}

fn dispatch(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    match (request.method.as_str(), request.path.as_str()) {
        ("POST", "/api/auth/register") => register(stream, request, state, head_only),
        ("POST", "/api/auth/login") => login(stream, request, state, head_only),
        ("POST", "/api/auth/logout") => logout(stream, request, state, head_only),
        ("GET", "/api/auth/me") => me(stream, request, state, head_only),
        ("POST", "/api/auth/profile") => profile(stream, request, state, head_only),
        ("POST", "/api/auth/password") => password(stream, request, state, head_only),
        ("GET", "/api/me/favorites") => favorites_list(stream, request, state, head_only),
        ("PUT", "/api/me/favorites") => favorite_save(stream, request, state, head_only),
        ("DELETE", "/api/me/favorites") => favorite_remove(stream, request, state, head_only),
        ("GET", "/api/me/progress") => progress_list(stream, request, state, head_only),
        ("PUT", "/api/me/progress") => progress_save(stream, request, state, head_only),
        ("DELETE", "/api/me/progress") => progress_remove(stream, request, state, head_only),
        _ => {
            send_error(
                stream,
                head_only,
                ApiError {
                    status: "404 Not Found",
                    code: "not_found",
                    message: "Not found",
                    field: None,
                    retry_after: None,
                },
            );
            Ok(())
        }
    }
}

fn register(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let client = client_key(request);
    if let Some(retry_after) = take_attempt(&state.limits, &client) {
        send_error(stream, head_only, rate_error(retry_after));
        return Ok(());
    }
    let value = match body_json(request) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let username = match string_field(&value, "username", 32) {
        Ok(value) if valid_username(&value) => value,
        _ => return Err(Some((stream, invalid("username")))),
    };
    let password = match value.get("password").and_then(Value::as_str) {
        Some(value) if (8..=128).contains(&value.chars().count()) => value,
        _ => return Err(Some((stream, invalid("password")))),
    };
    let display_name = match value.get("display_name") {
        None => username.clone(),
        Some(Value::String(value)) if (1..=40).contains(&value.chars().count()) => value.clone(),
        _ => return Err(Some((stream, invalid("display_name")))),
    };
    let password_phc = match hash_password(password) {
        Some(value) => value,
        None => return Err(Some((stream, unavailable_error()))),
    };
    let Some(store) = state.store.as_ref() else {
        return Err(Some((stream, unavailable_error())));
    };
    let user = match store.create_user(&username, &password_phc, &display_name, now()) {
        Ok(user) => user,
        Err(StoreError::Conflict) => {
            return Err(Some((
                stream,
                ApiError {
                    status: "409 Conflict",
                    code: "username_taken",
                    message: "Username is already taken",
                    field: Some("username"),
                    retry_after: None,
                },
            )))
        }
        Err(_) => return Err(Some((stream, unavailable_error()))),
    };
    let Some((token, hash)) = new_session() else {
        return Err(Some((stream, unavailable_error())));
    };
    if store
        .create_session(&hash, user.id, now() + SESSION_MAX_AGE)
        .is_err()
    {
        return Err(Some((stream, unavailable_error())));
    }
    send_json(
        stream,
        head_only,
        "201 Created",
        json!({"success": true, "user": user}),
        Some(cookie_header(&token, request)),
        false,
    );
    Ok(())
}

fn login(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let client = client_key(request);
    if let Some(retry_after) = take_attempt(&state.limits, &client) {
        send_error(stream, head_only, rate_error(retry_after));
        return Ok(());
    }
    let value = match body_json(request) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let username = match value.get("username").and_then(Value::as_str) {
        Some(value) => value.to_string(),
        None => return Err(Some((stream, invalid("username")))),
    };
    let password = match value.get("password").and_then(Value::as_str) {
        Some(value) => value,
        None => return Err(Some((stream, invalid("password")))),
    };
    // A name that could never have been registered is refused before it reaches the limiter
    // maps, whose keys would otherwise be attacker-sized strings.
    if !valid_username(&username) {
        return Err(Some((
            stream,
            ApiError {
                status: "401 Unauthorized",
                code: "invalid_credentials",
                message: "Invalid username or password",
                field: None,
                retry_after: None,
            },
        )));
    }
    let key = username.to_ascii_lowercase();
    if let Some(retry_after) = failed_user_limited(&state.limits, &key) {
        send_error(stream, head_only, rate_error(retry_after));
        return Ok(());
    }
    let Some(store) = state.store.as_ref() else {
        return Err(Some((stream, unavailable_error())));
    };
    let record = match store.find_user(&username) {
        Ok(record) => record,
        Err(_) => return Err(Some((stream, unavailable_error()))),
    };
    let candidate = record
        .as_ref()
        .map_or(DUMMY_HASH, |value| value.password_phc.as_str());
    let valid = verify_password(password, candidate);
    let Some(record) = record else {
        record_failed_user(&state.limits, &key);
        return Err(Some((
            stream,
            ApiError {
                status: "401 Unauthorized",
                code: "invalid_credentials",
                message: "Invalid username or password",
                field: None,
                retry_after: None,
            },
        )));
    };
    if !valid {
        record_failed_user(&state.limits, &key);
        return Err(Some((
            stream,
            ApiError {
                status: "401 Unauthorized",
                code: "invalid_credentials",
                message: "Invalid username or password",
                field: None,
                retry_after: None,
            },
        )));
    }
    clear_failed_user(&state.limits, &key);
    let user = record.user;
    let Some((token, hash)) = new_session() else {
        return Err(Some((stream, unavailable_error())));
    };
    if store
        .create_session(&hash, user.id, now() + SESSION_MAX_AGE)
        .is_err()
    {
        return Err(Some((stream, unavailable_error())));
    }
    send_json(
        stream,
        head_only,
        "200 OK",
        json!({"success": true, "user": user}),
        Some(cookie_header(&token, request)),
        false,
    );
    Ok(())
}

fn logout(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    if let Some(token) = session_cookie(request) {
        if let Ok(bytes) = URL_SAFE_NO_PAD.decode(token) {
            if bytes.len() == 32 {
                let hash = token_hash(&bytes);
                if let Some(store) = state.store.as_ref() {
                    let _ = store.delete_session(&hash);
                }
            }
        }
    }
    let secure = secure_cookie(request);
    let cookie = format!(
        "avs_session=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0{}",
        if secure { "; Secure" } else { "" }
    );
    send_json(
        stream,
        head_only,
        "200 OK",
        json!({"success": true}),
        Some(cookie),
        false,
    );
    Ok(())
}

fn me(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let auth = match require_auth(request, state) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    send_json(
        stream,
        head_only,
        "200 OK",
        json!({"success": true, "user": auth.user}),
        None,
        false,
    );
    Ok(())
}

fn profile(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let auth = match require_auth(request, state) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let value = match body_json(request) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let display_name = match value.get("display_name").and_then(Value::as_str) {
        Some(value) if (1..=40).contains(&value.chars().count()) => value,
        _ => return Err(Some((stream, invalid("display_name")))),
    };
    let Some(store) = state.store.as_ref() else {
        return Err(Some((stream, unavailable_error())));
    };
    let user = match store.set_display_name(auth.user.id, display_name) {
        Ok(Some(user)) => user,
        Ok(None) => return Err(Some((stream, unauthenticated()))),
        Err(_) => return Err(Some((stream, unavailable_error()))),
    };
    send_json(
        stream,
        head_only,
        "200 OK",
        json!({"success": true, "user": user}),
        None,
        false,
    );
    Ok(())
}

fn password(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let auth = match require_auth(request, state) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let value = match body_json(request) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let current = match value.get("current_password").and_then(Value::as_str) {
        Some(value) => value,
        None => return Err(Some((stream, invalid("current_password")))),
    };
    let new_password = match value.get("new_password").and_then(Value::as_str) {
        Some(value) if (8..=128).contains(&value.chars().count()) => value,
        _ => return Err(Some((stream, invalid("new_password")))),
    };
    let Some(store) = state.store.as_ref() else {
        return Err(Some((stream, unavailable_error())));
    };
    let record = match store.find_user(&auth.user.username) {
        Ok(Some(record)) => record,
        _ => return Err(Some((stream, unavailable_error()))),
    };
    if !verify_password(current, &record.password_phc) {
        return Err(Some((
            stream,
            ApiError {
                status: "401 Unauthorized",
                code: "invalid_credentials",
                message: "Invalid password",
                field: None,
                retry_after: None,
            },
        )));
    }
    let Some(password_phc) = hash_password(new_password) else {
        return Err(Some((stream, unavailable_error())));
    };
    if store
        .update_password(auth.user.id, &auth.token_hash, &password_phc)
        .is_err()
    {
        return Err(Some((stream, unavailable_error())));
    }
    send_json(
        stream,
        head_only,
        "200 OK",
        json!({"success": true}),
        None,
        false,
    );
    Ok(())
}

fn favorites_list(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let auth = match require_auth(request, state) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let Some(store) = state.store.as_ref() else {
        return Err(Some((stream, unavailable_error())));
    };
    let items = match store.list_favorites(auth.user.id) {
        Ok(items) => items,
        Err(_) => return Err(Some((stream, unavailable_error()))),
    };
    send_json(
        stream,
        head_only,
        "200 OK",
        json!({"success": true, "items": items}),
        None,
        false,
    );
    Ok(())
}

fn favorite_save(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let auth = match require_auth(request, state) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let value = match body_json(request) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let film = match value.get("film") {
        Some(value) => value,
        None => return Err(Some((stream, invalid("film")))),
    };
    let film_id = match validate_film(film) {
        Ok(value) => value,
        Err(field) => return Err(Some((stream, invalid(field)))),
    };
    let Some(store) = state.store.as_ref() else {
        return Err(Some((stream, unavailable_error())));
    };
    match store.save_favorite(auth.user.id, &film_id, &film.to_string(), now()) {
        Ok(()) => send_json(
            stream,
            head_only,
            "200 OK",
            json!({"success": true}),
            None,
            false,
        ),
        Err(StoreError::Conflict) => return Err(Some((stream, invalid("film")))),
        Err(_) => return Err(Some((stream, unavailable_error()))),
    }
    Ok(())
}

fn favorite_remove(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let auth = match require_auth(request, state) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let film_id = query_param(&request.query, "id").filter(|value| valid_film_id(value));
    let Some(film_id) = film_id else {
        return Err(Some((stream, invalid("id"))));
    };
    let Some(store) = state.store.as_ref() else {
        return Err(Some((stream, unavailable_error())));
    };
    if store.remove_favorite(auth.user.id, &film_id).is_err() {
        return Err(Some((stream, unavailable_error())));
    }
    send_json(
        stream,
        head_only,
        "200 OK",
        json!({"success": true}),
        None,
        false,
    );
    Ok(())
}

fn progress_list(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let auth = match require_auth(request, state) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let film_id = query_param(&request.query, "id");
    if film_id.as_ref().is_some_and(|value| !valid_film_id(value)) {
        return Err(Some((stream, invalid("id"))));
    }
    let Some(store) = state.store.as_ref() else {
        return Err(Some((stream, unavailable_error())));
    };
    let items = match store.list_progress(auth.user.id, film_id.as_deref()) {
        Ok(items) => items,
        Err(_) => return Err(Some((stream, unavailable_error()))),
    };
    send_json(
        stream,
        head_only,
        "200 OK",
        json!({"success": true, "items": items}),
        None,
        false,
    );
    Ok(())
}

fn progress_save(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let auth = match require_auth(request, state) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let value = match body_json(request) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let film = match value.get("film") {
        Some(value) => value,
        None => return Err(Some((stream, invalid("film")))),
    };
    let film_id = match validate_film(film) {
        Ok(value) => value,
        Err(field) => return Err(Some((stream, invalid(field)))),
    };
    let episode_value = value.get("episode").and_then(Value::as_object);
    let Some(episode_value) = episode_value else {
        return Err(Some((stream, invalid("episode"))));
    };
    let slug = episode_value
        .get("slug")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.chars().count() <= 200)
        .map(str::to_string);
    let name = episode_value
        .get("name")
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.chars().count() <= 300)
        .map(str::to_string);
    let (Some(slug), Some(name)) = (slug, name) else {
        return Err(Some((stream, invalid("episode"))));
    };
    let position = value
        .get("position")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0);
    let duration = value
        .get("duration")
        .and_then(Value::as_f64)
        .filter(|value| value.is_finite() && *value >= 0.0);
    let (Some(position), Some(duration)) = (position, duration) else {
        return Err(Some((stream, invalid("position"))));
    };
    let Some(store) = state.store.as_ref() else {
        return Err(Some((stream, unavailable_error())));
    };
    if store
        .upsert_progress(
            auth.user.id,
            &film_id,
            &film.to_string(),
            &Episode { slug, name },
            position,
            duration,
            now(),
        )
        .is_err()
    {
        return Err(Some((stream, unavailable_error())));
    }
    send_json(
        stream,
        head_only,
        "200 OK",
        json!({"success": true}),
        None,
        false,
    );
    Ok(())
}

fn progress_remove(
    stream: std::net::TcpStream,
    request: &Request,
    state: &AccountState,
    head_only: bool,
) -> Result<(), Option<(std::net::TcpStream, ApiError)>> {
    let auth = match require_auth(request, state) {
        Ok(value) => value,
        Err(error) => return Err(Some((stream, error))),
    };
    let Some(store) = state.store.as_ref() else {
        return Err(Some((stream, unavailable_error())));
    };
    // Clearing everything has to be asked for by name: a request that merely lost its `id`
    // must not empty the history.
    let removed = if query_param(&request.query, "all").as_deref() == Some("1") {
        store.clear_progress(auth.user.id)
    } else {
        let film_id = query_param(&request.query, "id").filter(|value| valid_film_id(value));
        let Some(film_id) = film_id else {
            return Err(Some((stream, invalid("id"))));
        };
        store.delete_progress(auth.user.id, &film_id)
    };
    if removed.is_err() {
        return Err(Some((stream, unavailable_error())));
    }
    send_json(
        stream,
        head_only,
        "200 OK",
        json!({"success": true}),
        None,
        false,
    );
    Ok(())
}

fn require_auth(request: &Request, state: &AccountState) -> Result<Authenticated, ApiError> {
    let Some(token) = session_cookie(request) else {
        return Err(unauthenticated());
    };
    let bytes = URL_SAFE_NO_PAD
        .decode(token)
        .map_err(|_| unauthenticated())?;
    if bytes.len() != 32 {
        return Err(unauthenticated());
    }
    let hash = token_hash(&bytes);
    let store = state.store.as_ref().ok_or_else(unavailable_error)?;
    let user = store
        .session_user(&hash, now())
        .map_err(|_| unavailable_error())?;
    let Some(user) = user else {
        return Err(unauthenticated());
    };
    Ok(Authenticated {
        user,
        token_hash: hash,
    })
}

fn send_json(
    stream: std::net::TcpStream,
    head_only: bool,
    status: &'static str,
    value: Value,
    cookie: Option<String>,
    _unused: bool,
) {
    let extra = cookie
        .map(|value| vec![("Set-Cookie", value)])
        .unwrap_or_default();
    http::send_response(
        stream,
        status,
        "application/json; charset=utf-8",
        value.to_string().as_bytes(),
        head_only,
        Some("no-store"),
        false,
        &extra,
    );
}

fn send_error(stream: std::net::TcpStream, head_only: bool, error: ApiError) {
    let mut value = json!({"success": false, "code": error.code, "error": error.message});
    if let Some(field) = error.field {
        value["field"] = Value::String(field.to_string());
    }
    if let Some(retry_after) = error.retry_after {
        value["retry_after"] = json!(retry_after);
    }
    http::send_response(
        stream,
        error.status,
        "application/json; charset=utf-8",
        value.to_string().as_bytes(),
        head_only,
        Some("no-store"),
        false,
        &[],
    );
}

fn body_json(request: &Request) -> Result<Value, ApiError> {
    if request.body.is_empty() {
        return Err(invalid("body"));
    }
    serde_json::from_slice(&request.body).map_err(|_| invalid("body"))
}

fn string_field(value: &Value, field: &'static str, max: usize) -> Result<String, ()> {
    value
        .get(field)
        .and_then(Value::as_str)
        .filter(|value| !value.is_empty() && value.chars().count() <= max)
        .map(str::to_string)
        .ok_or(())
}

fn validate_film(value: &Value) -> Result<String, &'static str> {
    let object = value.as_object().ok_or("film")?;
    let id = object
        .get("id")
        .and_then(Value::as_str)
        .filter(|value| valid_film_id(value))
        .ok_or("film")?;
    let source = object.get("source").and_then(Value::as_str).ok_or("film")?;
    if source != "avs" && source != "kk" {
        return Err("film");
    }
    if !bounded_string(object.get("title"), 300, false)
        || !bounded_url(object.get("poster"))
        || !bounded_url(object.get("banner"))
    {
        return Err("film");
    }
    let genres = object
        .get("genres")
        .and_then(Value::as_array)
        .ok_or("film")?;
    if genres.len() > 10 {
        return Err("film");
    }
    for genre in genres {
        let genre = genre.as_object().ok_or("film")?;
        if !bounded_string(genre.get("slug"), 200, false)
            || !bounded_string(genre.get("name"), 300, false)
        {
            return Err("film");
        }
    }
    Ok(id.to_string())
}

fn bounded_string(value: Option<&Value>, max: usize, allow_empty: bool) -> bool {
    value
        .and_then(Value::as_str)
        .is_some_and(|value| (allow_empty || !value.is_empty()) && value.chars().count() <= max)
}

fn bounded_url(value: Option<&Value>) -> bool {
    value.and_then(Value::as_str).is_some_and(|value| {
        value.is_empty()
            || (value.len() <= 500
                && value.strip_prefix("https://").is_some_and(|rest| {
                    !rest.is_empty()
                        && !rest
                            .bytes()
                            .any(|byte| byte.is_ascii_whitespace() || byte.is_ascii_control())
                }))
    })
}

fn valid_film_id(value: &str) -> bool {
    !value.is_empty()
        && value.chars().count() <= 200
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
}

fn valid_username(value: &str) -> bool {
    (3..=32).contains(&value.chars().count())
        && value
            .bytes()
            .all(|byte| byte.is_ascii_alphanumeric() || b"_.-".contains(&byte))
}

fn query_param(query: &str, wanted: &str) -> Option<String> {
    query.split('&').find_map(|part| {
        let (key, value) = part.split_once('=')?;
        (key == wanted).then(|| percent_decode(value))
    })
}

fn percent_decode(value: &str) -> String {
    let mut output = Vec::with_capacity(value.len());
    let bytes = value.as_bytes();
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' && index + 2 < bytes.len() {
            if let Ok(hex) = u8::from_str_radix(&value[index + 1..index + 3], 16) {
                output.push(hex);
                index += 3;
                continue;
            }
        }
        output.push(if bytes[index] == b'+' {
            b' '
        } else {
            bytes[index]
        });
        index += 1;
    }
    String::from_utf8_lossy(&output).into_owned()
}

fn session_cookie(request: &Request) -> Option<&str> {
    request.header("cookie")?.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        (name == "avs_session" && !value.is_empty()).then_some(value)
    })
}

fn cookie_header(token: &str, request: &Request) -> String {
    format!(
        "avs_session={token}; HttpOnly; SameSite=Lax; Path=/; Max-Age={SESSION_MAX_AGE}{}",
        if secure_cookie(request) {
            "; Secure"
        } else {
            ""
        }
    )
}

fn secure_cookie(request: &Request) -> bool {
    request
        .header("x-forwarded-proto")
        .is_some_and(|value| value.eq_ignore_ascii_case("https"))
}

fn origin_allowed(request: &Request) -> bool {
    let Some(origin) = request.header("origin") else {
        return true;
    };
    let Some(host) = request.header("host") else {
        return false;
    };
    let Some((_, origin_rest)) = origin.split_once("://") else {
        return false;
    };
    let Some(authority) = origin_rest.split('/').next() else {
        return false;
    };
    !authority.is_empty() && authority.eq_ignore_ascii_case(host.trim())
}

fn new_session() -> Option<(String, Vec<u8>)> {
    let mut bytes = [0_u8; 32];
    getrandom(&mut bytes).ok()?;
    let token = URL_SAFE_NO_PAD.encode(bytes);
    Some((token, token_hash(&bytes)))
}

fn token_hash(token: &[u8]) -> Vec<u8> {
    Sha256::digest(token).to_vec()
}

fn hash_password(password: &str) -> Option<String> {
    let _guard = PASSWORD_LOCK.lock().ok()?;
    let argon2_holder = ARGON2.as_ref();
    let argon2 = argon2_holder.as_ref()?;
    let mut salt = [0_u8; 16];
    getrandom(&mut salt).ok()?;
    let salt = SaltString::encode_b64(&salt).ok()?;
    argon2
        .hash_password(password.as_bytes(), &salt)
        .ok()
        .map(|hash| hash.to_string())
}

fn verify_password(password: &str, encoded: &str) -> bool {
    let Ok(_guard) = PASSWORD_LOCK.lock() else {
        return false;
    };
    let argon2_holder = ARGON2.as_ref();
    let Some(argon2) = argon2_holder.as_ref() else {
        return false;
    };
    let Ok(hash) = PasswordHash::new(encoded) else {
        return false;
    };
    argon2.verify_password(password.as_bytes(), &hash).is_ok()
}

fn client_key(request: &Request) -> String {
    if is_private(request.peer_addr.ip()) {
        if let Some(value) = request.header("x-forwarded-for").and_then(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|part| !part.is_empty())
                .next_back()
        }) {
            return value.to_string();
        }
    }
    request.peer_addr.ip().to_string()
}

fn is_private(address: IpAddr) -> bool {
    match address {
        IpAddr::V4(value) => value.is_loopback() || value.is_private() || value.is_link_local(),
        IpAddr::V6(value) => {
            value.is_loopback() || value.is_unique_local() || value.is_unicast_link_local()
        }
    }
}

fn take_attempt(limits: &Arc<Mutex<RateLimits>>, client: &str) -> Option<u64> {
    let mut limits = limits.lock().ok()?;
    let now = std::time::Instant::now();
    let entries = limits.clients.entry(client.to_string()).or_default();
    while entries
        .front()
        .is_some_and(|time| now.duration_since(*time) >= Duration::from_secs(3600))
    {
        entries.pop_front();
    }
    let minute_count = entries
        .iter()
        .filter(|time| now.duration_since(**time) < Duration::from_secs(60))
        .count();
    if minute_count >= 10 {
        return Some(60 - now.duration_since(*entries.front()?).as_secs());
    }
    if entries.len() >= 60 {
        return Some(3600 - now.duration_since(*entries.front()?).as_secs());
    }
    entries.push_back(now);
    if limits.clients.len() > 4096 {
        limits.clients.retain(|_, values| {
            values
                .back()
                .is_some_and(|time| now.duration_since(*time) < Duration::from_secs(3600))
        });
        while limits.clients.len() > 4096 {
            let Some(key) = limits.clients.keys().next().cloned() else {
                break;
            };
            limits.clients.remove(&key);
        }
    }
    None
}

fn failed_user_limited(limits: &Arc<Mutex<RateLimits>>, username: &str) -> Option<u64> {
    let limits = limits.lock().ok()?;
    let entry = limits.failed_users.get(username)?;
    let elapsed = entry.last_failed.elapsed();
    if entry.count >= 5 && elapsed < Duration::from_secs(300) {
        Some(300 - elapsed.as_secs())
    } else {
        None
    }
}

fn record_failed_user(limits: &Arc<Mutex<RateLimits>>, username: &str) {
    if let Ok(mut limits) = limits.lock() {
        let entry = limits
            .failed_users
            .entry(username.to_string())
            .or_insert(FailedUser {
                count: 0,
                last_failed: std::time::Instant::now(),
            });
        // A lock that has run out starts a fresh count instead of re-locking on the next slip.
        if entry.last_failed.elapsed() >= Duration::from_secs(300) {
            entry.count = 0;
        }
        entry.count = entry.count.saturating_add(1);
        entry.last_failed = std::time::Instant::now();
        if limits.failed_users.len() > 4096 {
            limits
                .failed_users
                .retain(|_, value| value.last_failed.elapsed() < Duration::from_secs(300));
            while limits.failed_users.len() > 4096 {
                let Some(key) = limits.failed_users.keys().next().cloned() else {
                    break;
                };
                limits.failed_users.remove(&key);
            }
        }
    }
}

fn clear_failed_user(limits: &Arc<Mutex<RateLimits>>, username: &str) {
    if let Ok(mut limits) = limits.lock() {
        limits.failed_users.remove(username);
    }
}

fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |value| value.as_secs() as i64)
}
fn is_account_path(path: &str) -> bool {
    path.starts_with("/api/auth/") || path.starts_with("/api/me/")
}
fn invalid(field: &'static str) -> ApiError {
    ApiError {
        status: "400 Bad Request",
        code: "invalid_input",
        message: "Invalid input",
        field: Some(field),
        retry_after: None,
    }
}
fn unauthenticated() -> ApiError {
    ApiError {
        status: "401 Unauthorized",
        code: "unauthenticated",
        message: "Authentication required",
        field: None,
        retry_after: None,
    }
}
fn unavailable_error() -> ApiError {
    ApiError {
        status: "503 Service Unavailable",
        code: "unavailable",
        message: "Account store is unavailable",
        field: None,
        retry_after: None,
    }
}
fn rate_error(seconds: u64) -> ApiError {
    ApiError {
        status: "429 Too Many Requests",
        code: "rate_limited",
        message: "Too many attempts",
        field: None,
        retry_after: Some(seconds.max(1)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn validates_limits_and_cookies() {
        assert!(valid_username("abc-_.9"));
        assert!(!valid_username("ab"));
        assert!(valid_film_id("kk_title.1"));
        assert!(!valid_film_id("bad id"));
        let request = Request {
            method: "GET".to_string(),
            path: "/".to_string(),
            query: String::new(),
            headers: HashMap::from([(
                "cookie".to_string(),
                "x=1; avs_session=abc; y=2".to_string(),
            )]),
            body: Vec::new(),
            peer_addr: "127.0.0.1:1".parse().expect("address"),
        };
        assert_eq!(session_cookie(&request), Some("abc"));
    }
}
