CREATE TABLE instance_setting (key TEXT PRIMARY KEY, value TEXT NOT NULL);
INSERT INTO instance_setting (key, value) VALUES ('session_lifetime_policy', 'PERMANENT');
