use thiserror::Error;

#[derive(Debug, Error)]
pub enum SaveError {
    #[error("{message}")]
    Coded { code: &'static str, message: String },
    #[error("{0}")]
    Message(String),
}

impl SaveError {
    pub fn code(code: &'static str, message: impl Into<String>) -> Self {
        Self::Coded { code, message: message.into() }
    }

    pub fn msg(message: impl Into<String>) -> Self {
        Self::Message(message.into())
    }
}

pub type SaveResult<T> = Result<T, SaveError>;
