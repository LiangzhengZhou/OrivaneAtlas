import {
  type ProviderErrorCategory,
  ProviderRequestError,
} from "@arclattice/application";

const messages: Record<ProviderErrorCategory, [string, string]> = {
  AUTH_INVALID: [
    "密钥无效或已过期，请检查连接密钥。",
    "The key is invalid or expired. Check the connection key.",
  ],
  PERMISSION_DENIED: [
    "服务商拒绝访问，请检查账户权限。",
    "The provider denied access. Check account permissions.",
  ],
  ENDPOINT_NOT_FOUND: [
    "找不到 API 入口，请检查连接地址。",
    "The API endpoint was not found. Check the connection URL.",
  ],
  METHOD_NOT_ALLOWED: [
    "服务不接受此请求方式，请检查 API 兼容性。",
    "The service rejected the request method. Check API compatibility.",
  ],
  RATE_LIMITED: [
    "请求过于频繁，请稍后再试。",
    "Too many requests. Try again later.",
  ],
  UPSTREAM_UNAVAILABLE: [
    "服务暂时不可用，请稍后再试。",
    "The service is temporarily unavailable. Try again later.",
  ],
  NETWORK_TIMEOUT: [
    "连接超时，请检查网络后重试。",
    "The connection timed out. Check your network and retry.",
  ],
  NETWORK_DNS: [
    "无法解析服务地址，请检查地址和网络。",
    "The service address could not be resolved. Check the URL and network.",
  ],
  TLS_ERROR: [
    "安全连接验证失败，请检查服务证书。",
    "The secure connection failed verification. Check the service certificate.",
  ],
  PROTOCOL_ERROR: [
    "服务响应不兼容，请检查连接配置。",
    "The response is incompatible. Check the connection settings.",
  ],
  UNSUPPORTED_DISCOVERY: [
    "模型自动发现不可用，请手动添加模型。",
    "Automatic model discovery is unavailable. Add a model manually.",
  ],
};

export function ProviderErrorNotice({
  error,
  zh,
}: {
  error: unknown;
  zh: boolean;
}) {
  const failure =
    error instanceof ProviderRequestError ? error.failure : undefined;
  const message = failure && messages[failure.category];
  return (
    <div role="alert">
      <p>
        {message
          ? message[zh ? 0 : 1]
          : zh
            ? "连接请求失败，请检查配置和网络。"
            : "The connection request failed. Check settings and your network."}
      </p>
      {failure && (
        <details>
          <summary>{zh ? "查看技术详情" : "Technical details"}</summary>
          <pre>{JSON.stringify(failure, null, 2)}</pre>
        </details>
      )}
    </div>
  );
}
