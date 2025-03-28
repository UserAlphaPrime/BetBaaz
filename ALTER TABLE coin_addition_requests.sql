  ALTER TABLE coin_addition_requests 
    ADD COLUMN IF NOT EXISTS processed_by_admin_id INT,
    ADD FOREIGN KEY (processed_by_admin_id) REFERENCES users(id)