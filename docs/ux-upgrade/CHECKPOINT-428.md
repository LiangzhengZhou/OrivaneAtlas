# v3.2.6 ZIP export release

The ZIP writer fix is commit 2b77ddb. Main and the annotated v3.2.6 tag point to 6eb42dc. All six public release assets match the local signed build. Windows updater and Android stable manifests resolve to v3.2.6.

The production source audit applied all 16 expected differences with zero drift. The staged host, SQLite backup and restore, public HTTPS health, index and entry script passed verification. No schema migration was required.

A signed in-place upgrade from v3.2.5 passed on a Windows CI runner and on the original Windows installation. The installed client exported a note using the ZIP menu. Windows Expand-Archive extracted the archive directly, all image references resolved, and both still images and animations decoded with byte-identical media. Locale-specific ZIP regression tests passed on all three browser projects. Android physical-device export was not tested.

[Release](https://github.com/LiangzhengZhou/OrivaneAtlas/releases/tag/v3.2.6) · [Signed upgrade](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/46057565949) · [Published signature](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/46057881230) · [Full candidate CI, pending at publication](https://github.com/LiangzhengZhou/OrivaneAtlas/actions/runs/46056789598)
