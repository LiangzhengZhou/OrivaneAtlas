package app.orivane.atlas

/** Pure validation rules, shared by the installer and JVM regression tests. */
internal object UpdatePolicy {
    fun assetUrl(url: String) {
        val prefix = "https://github.com/LiangzhengZhou/OrivaneAtlas/releases/download/"
        require(url.startsWith(prefix))
        val tail = url.removePrefix(prefix)
        require(tail.matches(Regex("[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+")))
        require(tail.split("/").none { it == "." || it == ".." })
    }

    fun downloaded(size: Long, expectedSize: Long, sha256: String, expectedHash: String) {
        require(size > 0 && size == expectedSize)
        require(expectedHash.matches(Regex("[a-f0-9]{64}")) && sha256 == expectedHash)
    }

    fun compatible(currentPackage: String, archivePackage: String?, currentCode: Long,
                   archiveCode: Long, expectedCode: Long, archiveVersion: String?,
                   expectedVersion: String, oldSignatures: Set<String>, newSignatures: Set<String>) {
        require(archivePackage == currentPackage)
        require(archiveCode > currentCode && archiveCode == expectedCode)
        require(archiveVersion == expectedVersion)
        require(oldSignatures.isNotEmpty() && newSignatures == oldSignatures)
    }
}
