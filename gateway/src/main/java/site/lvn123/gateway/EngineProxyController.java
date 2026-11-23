package site.lvn123.gateway;

import java.io.IOException;
import java.io.InputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.net.http.HttpTimeoutException;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;

import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class EngineProxyController {

	private final GatewayProperties properties;
	private final HttpClient client;

	public EngineProxyController(GatewayProperties properties) {
		this.properties = properties;
		this.client = HttpClient.newBuilder()
				.version(HttpClient.Version.HTTP_1_1)
				.connectTimeout(properties.connectTimeout())
				.followRedirects(HttpClient.Redirect.NEVER)
				.build();
	}

	@GetMapping("/api/**")
	public void proxy(HttpServletRequest request, HttpServletResponse response) {
		boolean responseStarted = false;
		try {
			URI upstreamUri = URI.create(upstreamTarget(request));
			HttpRequest upstreamRequest = HttpRequest.newBuilder(upstreamUri)
					.timeout(properties.requestTimeout())
					.header("User-Agent", "animora-gateway")
					.GET()
					.build();
			HttpResponse<InputStream> upstream = client.send(upstreamRequest,
					HttpResponse.BodyHandlers.ofInputStream());

			response.setStatus(upstream.statusCode());
			upstream.headers().firstValue("Content-Type").ifPresent(value -> response.setHeader("Content-Type", value));
			response.setHeader("Cache-Control", cachePolicy(request.getRequestURI(), upstream.statusCode()));
			responseStarted = true;
			try (InputStream body = upstream.body()) {
				body.transferTo(response.getOutputStream());
			}
		} catch (IllegalArgumentException e) {
			writeError(response, responseStarted, HttpServletResponse.SC_BAD_REQUEST, "Invalid upstream URI");
		} catch (HttpTimeoutException e) {
			writeError(response, responseStarted, HttpServletResponse.SC_GATEWAY_TIMEOUT, "Engine did not answer in time");
		} catch (InterruptedException e) {
			Thread.currentThread().interrupt();
			writeError(response, responseStarted, HttpServletResponse.SC_SERVICE_UNAVAILABLE, "Gateway request interrupted");
		} catch (IOException e) {
			writeError(response, responseStarted, HttpServletResponse.SC_BAD_GATEWAY, "Engine is unreachable");
		}
	}

	private String upstreamTarget(HttpServletRequest request) {
		String target = properties.engineUrl() + request.getRequestURI();
		String query = request.getQueryString();
		return query == null ? target : target + "?" + query;
	}

	private String cachePolicy(String path, int status) {
		if (status == HttpServletResponse.SC_OK
				&& !"/api/playlist.m3u8".equals(path)
				&& !"/api/extract".equals(path)) {
			return "public, max-age=60";
		}
		return "no-store";
	}

	private void writeError(HttpServletResponse response, boolean responseStarted, int status, String message) {
		if (responseStarted || response.isCommitted()) {
			return;
		}
		try {
			response.setStatus(status);
			response.setContentType("application/json; charset=utf-8");
			response.setHeader("Cache-Control", "no-store");
			response.getOutputStream().write(("{\"success\":false,\"error\":\"" + message + "\"}").getBytes(java.nio.charset.StandardCharsets.UTF_8));
		} catch (IOException ignored) {
			// The client may have disconnected while the error was being written.
		}
	}
}
