package site.lvn123.gateway;

import java.net.URI;
import java.time.Duration;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("gateway")
public record GatewayProperties(
		URI engineUrl,
		String webRoot,
		Duration connectTimeout,
		Duration requestTimeout) {

	public GatewayProperties {
		if (engineUrl == null) {
			throw new IllegalArgumentException("gateway.engine-url must be configured");
		}
		String value = engineUrl.toString();
		while (value.endsWith("/") && value.length() > 1) {
			value = value.substring(0, value.length() - 1);
		}
		engineUrl = URI.create(value);
		if (webRoot == null || !webRoot.endsWith("/")) {
			throw new IllegalArgumentException("gateway.web-root must end with '/'");
		}
	}
}
