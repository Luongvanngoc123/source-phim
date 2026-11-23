use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;
use std::sync::{Arc, Mutex};

const SCHEMA_VERSION: i32 = 1;

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
        connection.busy_timeout(std::time::Duration::from_secs(5))?;
        let version: i32 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if version == 0 {
            connection.execute_batch(
                "BEGIN;
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
                 PRAGMA user_version = 1;
                 COMMIT;",
            )?;
        } else if version != SCHEMA_VERSION {
            return Err(StoreError::Unavailable);
        }
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
        Ok(())
    }
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
}
