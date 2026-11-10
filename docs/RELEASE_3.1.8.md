# Orivane Atlas 3.1.8 — running timer focus and delete repair

## Changes

- Timer controls keep Pause only; the duplicate Stop control is removed.
- A task with a running timer sorts to the top of task lists regardless of the
  selected sort.
- Running timer cards use an accent background/border and left accent bar.
- Timer start/pause remains a versioned Work update, so connected desktop and
  mobile clients receive the running state through the normal workspace sync.
- Fixed the missing `LocalBodyUnavailableError` import that made the 3.1.7
  project-document offline delete fallback fail at runtime.
- Fixed the PostgreSQL migration registry checksum helper regression.
