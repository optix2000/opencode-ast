pub struct Worker {
    id: u64,
}

pub enum Mode {
    Fast,
    Safe,
}

impl Worker {
    pub fn new(id: u64) -> Self {
        Self { id }
    }
}
