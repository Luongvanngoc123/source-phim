use std::collections::HashMap;
use std::io::{BufReader, Read, Write};
use std::net::{SocketAddr, TcpStream};

pub const MAX_HEADERS: usize = 16 * 1024;
pub const MAX_BODY: usize = 32 * 1024;

#[derive(Debug)]
pub struct Request {
    pub method: String,
    pub path: String,
    pub query: String,
    pub headers: HashMap<String, String>,
    pub body: Vec<u8>,
    pub peer_addr: SocketAddr,
}

#[derive(Debug, PartialEq, Eq)]
pub enum ParseError {
    BadRequest,
    TooLarge,
}

impl Request {
    pub fn header(&self, name: &str) -> Option<&str> {
        self.headers
            .get(&name.to_ascii_lowercase())
            .map(String::as_str)
    }
}

pub fn read_request(
    reader: &mut BufReader<TcpStream>,
    peer_addr: SocketAddr,
) -> Result<Request, ParseError> {
    let mut header_bytes = Vec::with_capacity(1024);
    let mut one = [0_u8; 1];
    loop {
        let count = reader.read(&mut one).map_err(|_| ParseError::BadRequest)?;
        if count == 0 {
            return Err(ParseError::BadRequest);
        }
        header_bytes.push(one[0]);
        if header_bytes.len() > MAX_HEADERS {
            return Err(ParseError::TooLarge);
        }
        if header_bytes.ends_with(b"\r\n\r\n") || header_bytes.ends_with(b"\n\n") {
            break;
        }
    }

    let header_text = std::str::from_utf8(&header_bytes).map_err(|_| ParseError::BadRequest)?;
    let mut lines = header_text.split('\n');
    let request_line = lines
        .next()
        .ok_or(ParseError::BadRequest)?
        .trim_end_matches('\r');
    let mut parts = request_line.split_whitespace();
    let method = parts.next().ok_or(ParseError::BadRequest)?.to_string();
    let target = parts.next().ok_or(ParseError::BadRequest)?.to_string();
    let version = parts.next().ok_or(ParseError::BadRequest)?;
    if !version.starts_with("HTTP/") || parts.next().is_some() {
        return Err(ParseError::BadRequest);
    }

    let (path, query) = target
        .split_once('?')
        .map_or((target.as_str(), ""), |(path, query)| (path, query));
    if path.is_empty() || !path.starts_with('/') {
        return Err(ParseError::BadRequest);
    }
    let path = path.to_string();
    let query = query.to_string();
    let mut headers = HashMap::new();
    for line in lines {
        let line = line.trim_end_matches('\r');
        if line.is_empty() {
            break;
        }
        let (name, value) = line.split_once(':').ok_or(ParseError::BadRequest)?;
        let name = name.trim().to_ascii_lowercase();
        if name.is_empty()
            || !name
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-')
        {
            return Err(ParseError::BadRequest);
        }
        headers.insert(name, value.trim().to_string());
    }

    let content_length = match headers.get("content-length") {
        Some(value) => value.parse::<usize>().map_err(|_| ParseError::BadRequest)?,
        None => 0,
    };
    if content_length > MAX_BODY {
        return Err(ParseError::TooLarge);
    }
    if headers
        .get("transfer-encoding")
        .is_some_and(|value| !value.eq_ignore_ascii_case("identity"))
    {
        return Err(ParseError::BadRequest);
    }
    let mut body = vec![0_u8; content_length];
    reader
        .read_exact(&mut body)
        .map_err(|_| ParseError::BadRequest)?;

    Ok(Request {
        method,
        path,
        query,
        headers,
        body,
        peer_addr,
    })
}

pub fn send_response(
    mut stream: TcpStream,
    status: &str,
    content_type: &str,
    body: &[u8],
    head_only: bool,
    cache_control: Option<&str>,
    cors: bool,
    extra_headers: &[(&str, String)],
) {
    let mut header = format!(
        "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n",
        body.len()
    );
    if let Some(value) = cache_control {
        header.push_str(&format!("Cache-Control: {value}\r\n"));
    }
    if cors {
        header.push_str("Access-Control-Allow-Origin: *\r\nAccess-Control-Allow-Methods: GET, HEAD, POST, PUT, DELETE, OPTIONS\r\nAccess-Control-Allow-Headers: Content-Type, Authorization, X-Requested-With\r\n");
    }
    for (name, value) in extra_headers {
        header.push_str(name);
        header.push_str(": ");
        header.push_str(value);
        header.push_str("\r\n");
    }
    header.push_str("\r\n");
    let _ = stream.write_all(header.as_bytes());
    if !head_only {
        let _ = stream.write_all(body);
    }
    let _ = stream.flush();
}

pub fn error_body(code: &str, error: &str, field: Option<&str>) -> Vec<u8> {
    let mut value = serde_json::json!({"success": false, "code": code, "error": error});
    if let Some(field) = field {
        value["field"] = serde_json::Value::String(field.to_string());
    }
    value.to_string().into_bytes()
}

pub fn parse_error_body(error: ParseError) -> (&'static str, Vec<u8>) {
    match error {
        ParseError::TooLarge => (
            "413 Payload Too Large",
            error_body("too_large", "Request body is too large", None),
        ),
        ParseError::BadRequest => (
            "400 Bad Request",
            error_body("invalid_input", "Invalid HTTP request", None),
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cookie_and_header_names_are_case_insensitive() {
        let mut headers = HashMap::new();
        headers.insert("cookie".to_string(), "avs_session=abc".to_string());
        let request = Request {
            method: "GET".to_string(),
            path: "/".to_string(),
            query: String::new(),
            headers,
            body: Vec::new(),
            peer_addr: "127.0.0.1:1".parse().expect("literal address"),
        };
        assert_eq!(request.header("Cookie"), Some("avs_session=abc"));
    }

    #[test]
    fn body_limit_is_reported() {
        assert_eq!(
            parse_error_body(ParseError::TooLarge).0,
            "413 Payload Too Large"
        );
    }
}
