use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

const SCHEMA_VERSION: i32 = 2;

const CREATE_SCHEMA: &str = "
    CREATE TABLE users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT NOT NULL,
        password_phc TEXT NOT NULL,
        display_name TEXT NOT NULL,
        created_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX users_username_lower ON users(lower(username));
    CREATE TABLE sessions (
        token_hash BLOB PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at INTEGER NOT NULL
    );
    CREATE INDEX sessions_user_id ON sessions(user_id);
    CREATE TABLE favorites (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        film_id TEXT NOT NULL,
        film_json TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, film_id)
    );
    CREATE INDEX favorites_newest ON favorites(user_id, saved_at DESC);
    CREATE TABLE progress (
        user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        film_id TEXT NOT NULL,
        episode_slug TEXT NOT NULL,
        episode_name TEXT NOT NULL,
        film_json TEXT NOT NULL,
        position REAL NOT NULL,
        duration REAL NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY(user_id, film_id, episode_slug)
    );
    CREATE INDEX progress_updated ON progress(user_id, updated_at DESC);
";

#[derive(Debug)]
pub enum StoreError {
    Sqlite,
    Unavailable,
    Conflict,
}

impl From<rusqlite::Error> for StoreError {
    fn from(_: rusqlite::Error) -> Self {
        Self::Sqlite
    }
}

#[derive(Clone)]
pub struct AccountStore {
    connection: Arc<Mutex<Connection>>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub display_name: String,
    pub created_at: i64,
}

#[derive(Clone, Debug)]
pub struct UserRecord {
    pub user: User,
    pub password_phc: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Favorite {
    pub film: serde_json::Value,
    pub saved_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Progress {
    pub film: serde_json::Value,
    pub episode: Episode,
    pub position: f64,
    pub duration: f64,
    pub updated_at: i64,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
pub struct Episode {
    pub slug: String,
    pub name: String,
}

impl AccountStore {
    pub fn open(data_dir: &Path) -> Result<Self, StoreError> {
        fs::create_dir_all(data_dir).map_err(|_| StoreError::Unavailable)?;
        let path = data_dir.join("accounts.db");
        let connection = Connection::open(path)?;
        Self::configure(connection)
    }

    #[cfg(test)]
    pub fn in_memory() -> Result<Self, StoreError> {
        Self::configure(Connection::open_in_memory()?)
    }

    fn configure(connection: Connection) -> Result<Self, StoreError> {
        connection.pragma_update(None, "journal_mode", "WAL")?;
        // A removed row is overwritten with zeros. By default SQLite only marks its space as
        // free, and what a viewer asked to forget would stay readable in the file.
        connection.pragma_update(None, "secure_delete", "ON")?;
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        let version: i32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        match version {
            0 => connection.execute_batch(&format!(
                "BEGIN; {CREATE_SCHEMA} PRAGMA user_version = {SCHEMA_VERSION}; COMMIT;"
            ))?,
            // Version 1 has the same tables but removed rows without overwriting them. The
            // file is rebuilt once, which drops the free space those rows still sit in.
            1 => connection
                .execute_batch(&format!("VACUUM; PRAGMA user_version = {SCHEMA_VERSION};"))?,
            SCHEMA_VERSION => {}
            _ => return Err(StoreError::Unavailable),
        }
        empty_write_ahead_log(&connection);
        Ok(Self {
            connection: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn is_open(&self) -> bool {
        self.connection.lock().is_ok()
    }

    pub fn create_user(
        &self,
        username: &str,
        password_phc: &str,
        display_name: &str,
        created_at: i64,
    ) -> Result<User, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        let changed = connection.execute(
            "INSERT INTO users (username, password_phc, display_name, created_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT DO NOTHING",
            params![username, password_phc, display_name, created_at],
        )?;
        if changed == 0 {
            return Err(StoreError::Conflict);
        }
        let id = connection.last_insert_rowid();
        Ok(User {
            id,
            username: username.to_string(),
            display_name: display_name.to_string(),
            created_at,
        })
    }

    pub fn find_user(&self, username: &str) -> Result<Option<UserRecord>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        connection
            .query_row(
                "SELECT id, username, display_name, created_at, password_phc FROM users WHERE lower(username) = lower(?1)",
                params![username],
                |row| {
                    Ok(UserRecord {
                        user: User {
                            id: row.get(0)?,
                            username: row.get(1)?,
                            display_name: row.get(2)?,
                            created_at: row.get(3)?,
                        },
                        password_phc: row.get(4)?,
                    })
                },
            )
            .optional()
            .map_err(StoreError::from)
    }

    pub fn set_display_name(
        &self,
        user_id: i64,
        display_name: &str,
    ) -> Result<Option<User>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        connection.execute(
            "UPDATE users SET display_name = ?1 WHERE id = ?2",
            params![display_name, user_id],
        )?;
        connection
            .query_row(
                "SELECT id, username, display_name, created_at FROM users WHERE id = ?1",
                params![user_id],
                |row| {
                    Ok(User {
                        id: row.get(0)?,
                        username: row.get(1)?,
                        display_name: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(StoreError::from)
    }

    pub fn update_password(
        &self,
        user_id: i64,
        keep_token_hash: &[u8],
        password_phc: &str,
    ) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        connection.execute(
            "UPDATE users SET password_phc = ?1 WHERE id = ?2",
            params![password_phc, user_id],
        )?;
        connection.execute(
            "DELETE FROM sessions WHERE user_id = ?1 AND token_hash != ?2",
            params![user_id, keep_token_hash],
        )?;
        Ok(())
    }

    pub fn create_session(
        &self,
        token_hash: &[u8],
        user_id: i64,
        expires_at: i64,
    ) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        // Sessions that ran out are only ever seen again by chance, so each sign-in sweeps
        // them; the table then holds live sessions only.
        connection.execute(
            "DELETE FROM sessions WHERE expires_at <= CAST(strftime('%s', 'now') AS INTEGER)",
            [],
        )?;
        connection.execute(
            "INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?1, ?2, ?3)",
            params![token_hash, user_id, expires_at],
        )?;
        Ok(())
    }

    pub fn session_user(&self, token_hash: &[u8], now: i64) -> Result<Option<User>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        let row = connection
            .query_row(
                "SELECT user_id, expires_at FROM sessions WHERE token_hash = ?1",
                params![token_hash],
                |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)),
            )
            .optional()?;
        let Some((user_id, expires_at)) = row else {
            return Ok(None);
        };
        if expires_at <= now {
            connection.execute(
                "DELETE FROM sessions WHERE token_hash = ?1",
                params![token_hash],
            )?;
            return Ok(None);
        }
        connection
            .query_row(
                "SELECT id, username, display_name, created_at FROM users WHERE id = ?1",
                params![user_id],
                |row| {
                    Ok(User {
                        id: row.get(0)?,
                        username: row.get(1)?,
                        display_name: row.get(2)?,
                        created_at: row.get(3)?,
                    })
                },
            )
            .optional()
            .map_err(StoreError::from)
    }

    pub fn delete_session(&self, token_hash: &[u8]) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        connection.execute(
            "DELETE FROM sessions WHERE token_hash = ?1",
            params![token_hash],
        )?;
        Ok(())
    }

    pub fn list_favorites(&self, user_id: i64) -> Result<Vec<Favorite>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        let mut statement = connection.prepare(
            "SELECT film_json, saved_at FROM favorites WHERE user_id = ?1 ORDER BY saved_at DESC, film_id DESC",
        )?;
        let rows = statement.query_map(params![user_id], |row| {
            let film_json: String = row.get(0)?;
            Ok(Favorite {
                film: serde_json::from_str(&film_json).unwrap_or(serde_json::Value::Null),
                saved_at: row.get(1)?,
            })
        })?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)
    }

    pub fn save_favorite(
        &self,
        user_id: i64,
        film_id: &str,
        film_json: &str,
        saved_at: i64,
    ) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        let existing: Option<i64> = connection
            .query_row(
                "SELECT 1 FROM favorites WHERE user_id = ?1 AND film_id = ?2",
                params![user_id, film_id],
                |row| row.get(0),
            )
            .optional()?;
        if existing.is_none() {
            let count: i64 = connection.query_row(
                "SELECT COUNT(*) FROM favorites WHERE user_id = ?1",
                params![user_id],
                |row| row.get(0),
            )?;
            if count >= 500 {
                return Err(StoreError::Conflict);
            }
        }
        connection.execute(
            "INSERT INTO favorites (user_id, film_id, film_json, saved_at) VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(user_id, film_id) DO UPDATE SET film_json = excluded.film_json, saved_at = excluded.saved_at",
            params![user_id, film_id, film_json, saved_at],
        )?;
        Ok(())
    }

    pub fn remove_favorite(&self, user_id: i64, film_id: &str) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        connection.execute(
            "DELETE FROM favorites WHERE user_id = ?1 AND film_id = ?2",
            params![user_id, film_id],
        )?;
        empty_write_ahead_log(&connection);
        Ok(())
    }

    pub fn upsert_progress(
        &self,
        user_id: i64,
        film_id: &str,
        film_json: &str,
        episode: &Episode,
        position: f64,
        duration: f64,
        updated_at: i64,
    ) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        connection.execute(
            "INSERT INTO progress (user_id, film_id, episode_slug, episode_name, film_json, position, duration, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(user_id, film_id, episode_slug) DO UPDATE SET episode_name = excluded.episode_name,
             film_json = excluded.film_json, position = excluded.position, duration = excluded.duration, updated_at = excluded.updated_at",
            params![user_id, film_id, episode.slug, episode.name, film_json, position, duration, updated_at],
        )?;
        connection.execute(
            "DELETE FROM progress WHERE user_id = ?1 AND rowid IN
             (SELECT rowid FROM progress WHERE user_id = ?1 ORDER BY updated_at DESC, rowid DESC LIMIT -1 OFFSET 2000)",
            params![user_id],
        )?;
        Ok(())
    }

    pub fn list_progress(
        &self,
        user_id: i64,
        film_id: Option<&str>,
    ) -> Result<Vec<Progress>, StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        let sql = if film_id.is_some() {
            "SELECT film_json, episode_slug, episode_name, position, duration, updated_at FROM progress WHERE user_id = ?1 AND film_id = ?2 ORDER BY updated_at DESC, rowid DESC"
        } else {
            "SELECT film_json, episode_slug, episode_name, position, duration, updated_at FROM progress WHERE user_id = ?1 ORDER BY updated_at DESC, rowid DESC"
        };
        let mut statement = connection.prepare(sql)?;
        let rows = if let Some(film_id) = film_id {
            statement.query_map(params![user_id, film_id], progress_from_row)?
        } else {
            statement.query_map(params![user_id], progress_from_row)?
        };
        let mut entries = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(StoreError::from)?;
        if film_id.is_none() {
            let mut seen = std::collections::HashSet::new();
            entries.retain(|entry| {
                entry
                    .film
                    .get("id")
                    .and_then(serde_json::Value::as_str)
                    .is_some_and(|id| seen.insert(id.to_string()))
            });
            entries.truncate(100);
        }
        Ok(entries)
    }

    pub fn delete_progress(&self, user_id: i64, film_id: &str) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        connection.execute(
            "DELETE FROM progress WHERE user_id = ?1 AND film_id = ?2",
            params![user_id, film_id],
        )?;
        empty_write_ahead_log(&connection);
        Ok(())
    }

    /// Removes every saved position of one account, listed in the client or not.
    pub fn clear_progress(&self, user_id: i64) -> Result<(), StoreError> {
        let connection = self
            .connection
            .lock()
            .map_err(|_| StoreError::Unavailable)?;
        connection.execute("DELETE FROM progress WHERE user_id = ?1", params![user_id])?;
        empty_write_ahead_log(&connection);
        Ok(())
    }
}

/// Folds the write-ahead log into the database file and truncates it. The log keeps each page
/// as it was before a change, so until this runs a removed row is still on disk there.
fn empty_write_ahead_log(connection: &Connection) {
    // Best effort: the change itself is already committed, and the next call tries again.
    let _ = connection.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()));
}

fn progress_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<Progress> {
    let film_json: String = row.get(0)?;
    Ok(Progress {
        film: serde_json::from_str(&film_json).unwrap_or(serde_json::Value::Null),
        episode: Episode {
            slug: row.get(1)?,
            name: row.get(2)?,
        },
        position: row.get(3)?,
        duration: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn schema_and_limits_work() {
        let store = AccountStore::in_memory().expect("store");
        let user = store.create_user("Alice", "phc", "Alice", 1).expect("user");
        for index in 0..501 {
            let film = serde_json::json!({"id": format!("f{index}")}).to_string();
            let result = store.save_favorite(user.id, &format!("f{index}"), &film, index);
            if index < 500 {
                result.expect("favorite");
            } else {
                assert!(matches!(result, Err(StoreError::Conflict)));
            }
        }
        assert_eq!(store.list_favorites(user.id).expect("favorites").len(), 500);
    }

    /// A directory under the system temp dir, removed when the test ends.
    struct TempDir(std::path::PathBuf);

    impl TempDir {
        fn new(name: &str) -> Self {
            let path =
                std::env::temp_dir().join(format!("avs-store-{}-{name}", std::process::id()));
            let _ = fs::remove_dir_all(&path);
            fs::create_dir_all(&path).expect("temp dir");
            Self(path)
        }
    }

    impl Drop for TempDir {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    /// Whether the text occurs anywhere in the database file or its write-ahead log.
    fn on_disk(dir: &Path, text: &str) -> bool {
        ["accounts.db", "accounts.db-wal"].iter().any(|name| {
            fs::read(dir.join(name)).is_ok_and(|bytes| {
                bytes
                    .windows(text.len())
                    .any(|window| window == text.as_bytes())
            })
        })
    }

    fn episode(slug: &str) -> Episode {
        Episode {
            slug: slug.to_string(),
            name: slug.to_string(),
        }
    }

    #[test]
    fn removed_history_and_saved_films_leave_nothing_on_disk() {
        let dir = TempDir::new("removed");
        let store = AccountStore::open(&dir.0).expect("store");
        let user = store.create_user("Alice", "phc", "Alice", 1).expect("user");
        for (film, title, at) in [
            ("film-one-marker", r#"{"title":"title-one-marker"}"#, 1),
            ("film-two-marker", r#"{"title":"title-two-marker"}"#, 2),
        ] {
            store
                .upsert_progress(user.id, film, title, &episode("tap-01"), 10.0, 100.0, at)
                .expect("progress");
        }
        store
            .save_favorite(
                user.id,
                "film-saved-marker",
                r#"{"title":"title-saved-marker"}"#,
                3,
            )
            .expect("favorite");
        // The probe sees rows that are stored, so the checks below mean something.
        assert!(on_disk(&dir.0, "title-one-marker"));

        store
            .delete_progress(user.id, "film-one-marker")
            .expect("delete");
        assert!(!on_disk(&dir.0, "one-marker"));
        assert!(on_disk(&dir.0, "title-two-marker"));

        store.clear_progress(user.id).expect("clear");
        assert!(!on_disk(&dir.0, "two-marker"));

        store
            .remove_favorite(user.id, "film-saved-marker")
            .expect("remove");
        assert!(!on_disk(&dir.0, "saved-marker"));
    }

    #[test]
    fn clearing_history_spares_other_accounts_and_saved_films() {
        let store = AccountStore::in_memory().expect("store");
        let alice = store.create_user("Alice", "phc", "Alice", 1).expect("user");
        let bob = store.create_user("Bob", "phc", "Bob", 1).expect("user");
        for (user, film) in [(&alice, "a1"), (&alice, "a2"), (&bob, "b1")] {
            // The listing reads the film id out of the stored JSON, as the API writes it.
            let json = format!(r#"{{"id":"{film}"}}"#);
            store
                .upsert_progress(user.id, film, &json, &episode("tap-01"), 10.0, 100.0, 1)
                .expect("progress");
        }
        store
            .save_favorite(alice.id, "a1", "{}", 1)
            .expect("favorite");

        store.clear_progress(alice.id).expect("clear");

        assert!(store
            .list_progress(alice.id, None)
            .expect("list")
            .is_empty());
        assert_eq!(store.list_progress(bob.id, None).expect("list").len(), 1);
        assert_eq!(store.list_favorites(alice.id).expect("favorites").len(), 1);
    }

    #[test]
    fn version_one_database_is_upgraded_and_scrubbed() {
        let dir = TempDir::new("upgrade");
        {
            // A database as the first release left it: the same tables, and a row removed
            // without being overwritten.
            let old = Connection::open(dir.0.join("accounts.db")).expect("open");
            old.pragma_update(None, "journal_mode", "WAL").expect("wal");
            old.pragma_update(None, "secure_delete", "OFF")
                .expect("pragma");
            old.execute_batch(&format!(
                "BEGIN; {CREATE_SCHEMA} PRAGMA user_version = 1; COMMIT;
                 INSERT INTO users (username, password_phc, display_name, created_at)
                 VALUES ('Alice', 'phc', 'Alice', 1);
                 INSERT INTO progress VALUES
                 (1, 'film-kept-marker', 't', 't', '{{\"id\":\"film-kept-marker\"}}', 1.0, 9.0, 1);
                 INSERT INTO progress VALUES (1, 'film-gone-marker', 't', 't', '{{}}', 1.0, 9.0, 2);
                 DELETE FROM progress WHERE film_id = 'film-gone-marker';"
            ))
            .expect("old database");
        }
        assert!(on_disk(&dir.0, "film-gone-marker"));

        let store = AccountStore::open(&dir.0).expect("upgrade");

        assert!(!on_disk(&dir.0, "film-gone-marker"));
        assert_eq!(store.list_progress(1, None).expect("list").len(), 1);
        assert!(store.find_user("alice").expect("find").is_some());
    }
}
