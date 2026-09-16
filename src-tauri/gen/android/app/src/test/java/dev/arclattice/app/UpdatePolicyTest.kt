package dev.arclattice.app

import org.junit.Test
import org.junit.Assert.assertThrows

class UpdatePolicyTest {
    @Test fun acceptsOnlyProjectAssets() {
        UpdatePolicy.assetUrl("https://github.com/LiangzhengZhou/OrivaneAtlas/releases/download/v0.0.4/app.apk")
        for (url in listOf("http://github.com/LiangzhengZhou/OrivaneAtlas/releases/download/v1/a.apk",
            "https://github.com/other/repo/releases/download/v1/a.apk",
            "https://github.com/LiangzhengZhou/OrivaneAtlas/releases/download/../a.apk",
            "https://github.com/LiangzhengZhou/OrivaneAtlas/releases/download/v1/a.apk?q=x")) {
            assertThrows(IllegalArgumentException::class.java) { UpdatePolicy.assetUrl(url) }
        }
    }
    @Test fun rejectsIncompleteAndTamperedDownloads() {
        val hash = "a".repeat(64)
        UpdatePolicy.downloaded(100, 100, hash, hash)
        assertThrows(IllegalArgumentException::class.java) { UpdatePolicy.downloaded(99, 100, hash, hash) }
        assertThrows(IllegalArgumentException::class.java) { UpdatePolicy.downloaded(100, 100, "b".repeat(64), hash) }
    }
    @Test fun requiresSameSignerPackageAndIncreasingVersion() {
        fun check(pkg: String = "app", code: Long = 5, signer: Set<String> = setOf("release"), version: String = "0.0.5") =
            UpdatePolicy.compatible("app", pkg, 4, code, 5, version, "0.0.5", setOf("release"), signer)
        check()
        assertThrows(IllegalArgumentException::class.java) { check(pkg = "other") }
        assertThrows(IllegalArgumentException::class.java) { check(code = 4) }
        assertThrows(IllegalArgumentException::class.java) { check(code = 3) }
        assertThrows(IllegalArgumentException::class.java) { check(code = 6) }
        assertThrows(IllegalArgumentException::class.java) { check(signer = setOf("debug")) }
        assertThrows(IllegalArgumentException::class.java) { check(signer = emptySet()) }
        assertThrows(IllegalArgumentException::class.java) { check(version = "0.0.6") }
    }
}
