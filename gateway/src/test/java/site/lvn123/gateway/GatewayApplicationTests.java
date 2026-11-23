package site.lvn123.gateway;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.io.OutputStream;
import java.net.InetSocketAddress;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executors;

import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class GatewayApplicationTests {

	private static final HttpServer ENGINE;
	private static final Path WEB_ROOT;
	private static final Map<String, String> TARGETS = new ConcurrentHashMap<>();
	private static final HttpClient CLIENT = HttpClient.newHttpClient();

	static {
		try {
			WEB_ROOT = Files.createTempDirectory("gateway-web");
			Files.createDirectories(WEB_ROOT.resolve("assets"));
			Files.writeString(WEB_ROOT.resolve("index.html"), "Animora index");
			Files.writeString(WEB_ROOT.resolve("assets/app.js"), "console.log('app');");
			ENGINE = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
			ENGINE.createContext("/", GatewayApplicationTests::handleEngine);
			ENGINE.setExecutor(Executors.newVirtualThreadPerTaskExecutor());
			ENGINE.start();
		}
		catch (IOException exception) {
			throw new ExceptionInInitializerError(exception);
		}
	}

	@Value("${local.server.port}")
	private int port;

	@DynamicPropertySource
	static void dynamicProperties(DynamicPropertyRegistry registry) {
		registry.add("gateway.engine-url",
				() -> "http://127.0.0.1:" + ENGINE.getAddress().getPort());
		registry.add("gateway.web-root", () -> WEB_ROOT.toUri().toString());
		registry.add("gateway.connect-timeout", () -> "1s");
		registry.add("gateway.request-timeout", () -> "500ms");
	}

	@AfterAll
	static void stopEngine() throws IOException {
		ENGINE.stop(0);
	}

	@Test
	void forwardsRawPlaylistTargetAndStreamsResponse() throws Exception {
		String target = "/api/playlist.m3u8?url=https%3A%2F%2Fanimevietsub.bid%2Fphim%2Fa-b%2Ftap-01-1.html&x=a+b";

		HttpResponse<String> response = get(target);

		assertEquals(target, TARGETS.get("/api/playlist.m3u8"));
		assertEquals(200, response.statusCode());
		assertEquals("#EXTM3U", response.body());
		assertEquals("application/vnd.apple.mpegurl", response.headers().firstValue("Content-Type").orElseThrow());
		assertEquals("no-store", response.headers().firstValue("Cache-Control").orElseThrow());
	}

	@Test
	void forwardsStatusBodyAndOnlySelectedHeaders() throws Exception {
		HttpResponse<String> notFound = get("/api/not-found");
		assertEquals(404, notFound.statusCode());
		assertEquals("{\"success\":false,\"error\":\"missing\"}", notFound.body());
		assertEquals("no-store", notFound.headers().firstValue("Cache-Control").orElseThrow());
		assertFalse(notFound.headers().firstValue("Access-Control-Allow-Origin").isPresent());

		HttpResponse<String> home = get("/api/home");
		assertEquals(200, home.statusCode());
		assertEquals("public, max-age=60", home.headers().firstValue("Cache-Control").orElseThrow());
	}

	@Test
	void mapsEngineFailuresToGatewayErrors() throws Exception {
		HttpResponse<String> unreachable = get("/api/close");
		assertEquals(502, unreachable.statusCode());
		assertTrue(unreachable.body().contains("\"success\":false"));

		HttpResponse<String> timeout = get("/api/slow");
		assertEquals(504, timeout.statusCode());
		assertTrue(timeout.body().contains("\"success\":false"));
	}

	@Test
	void servesSpaAndAssetsWithSeparatePolicies() throws Exception {
		HttpResponse<String> route = get("/phim/some.slug-a1/tap/123");
		assertEquals(200, route.statusCode());
		assertEquals("Animora index", route.body());
		assertEquals("no-cache", route.headers().firstValue("Cache-Control").orElseThrow());

		HttpResponse<String> root = get("/");
		assertEquals(200, root.statusCode());
		assertEquals("Animora index", root.body());
		assertEquals("no-cache", root.headers().firstValue("Cache-Control").orElseThrow());

		HttpResponse<String> asset = get("/assets/app.js");
		assertEquals(200, asset.statusCode());
		assertEquals("console.log('app');", asset.body());
		assertEquals("max-age=31536000, public, immutable",
				asset.headers().firstValue("Cache-Control").orElseThrow());

		assertEquals(404, get("/assets/missing.js").statusCode());
	}

	@Test
	void doesNotUseSpaFallbackForApiPaths() throws Exception {
		HttpResponse<String> response = get("/api/unknown");

		assertEquals(200, response.statusCode());
		assertEquals("{\"success\":true,\"from\":\"engine\"}", response.body());
		assertEquals("/api/unknown", TARGETS.get("/api/unknown"));
	}

	private HttpResponse<String> get(String target) throws IOException, InterruptedException {
		HttpRequest request = HttpRequest.newBuilder(URI.create("http://127.0.0.1:" + port + target))
				.GET()
				.build();
		return CLIENT.send(request, HttpResponse.BodyHandlers.ofString());
	}

	private static void handleEngine(HttpExchange exchange) throws IOException {
		String target = exchange.getRequestURI().toASCIIString();
		String path = exchange.getRequestURI().getPath();
		TARGETS.put(path, target);
		if ("/api/close".equals(path)) {
			exchange.close();
			return;
		}
		if ("/api/slow".equals(path)) {
			try {
				Thread.sleep(2000);
			}
			catch (InterruptedException exception) {
				Thread.currentThread().interrupt();
				return;
			}
		}

		int status = 200;
		String contentType = "application/json";
		String body = "{\"success\":true,\"from\":\"engine\"}";
		if ("/api/playlist.m3u8".equals(path)) {
			contentType = "application/vnd.apple.mpegurl";
			body = "#EXTM3U";
		}
		else if ("/api/not-found".equals(path)) {
			status = 404;
			body = "{\"success\":false,\"error\":\"missing\"}";
		}
		else if ("/api/home".equals(path)) {
			body = "{\"success\":true,\"from\":\"home\"}";
		}
		exchange.getResponseHeaders().set("Content-Type", contentType);
		exchange.getResponseHeaders().set("Access-Control-Allow-Origin", "*");
		byte[] bytes = body.getBytes(java.nio.charset.StandardCharsets.UTF_8);
		try {
			exchange.sendResponseHeaders(status, bytes.length);
			try (OutputStream output = exchange.getResponseBody()) {
				output.write(bytes);
			}
		}
		catch (IOException ignored) {
			// The gateway may close a timed-out request before the delayed response is written.
		}
	}
}
