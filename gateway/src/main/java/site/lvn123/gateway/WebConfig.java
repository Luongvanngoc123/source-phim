package site.lvn123.gateway;

import java.io.IOException;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.core.io.Resource;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.ViewControllerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;
import org.springframework.web.servlet.resource.PathResourceResolver;

@Configuration
public class WebConfig implements WebMvcConfigurer {

	private final GatewayProperties properties;

	public WebConfig(GatewayProperties properties) {
		this.properties = properties;
	}

	@Override
	public void addResourceHandlers(ResourceHandlerRegistry registry) {
		registry.addResourceHandler("/assets/**")
				.addResourceLocations(properties.webRoot() + "assets/")
				.setCacheControl(CacheControl.maxAge(java.time.Duration.ofDays(365)).cachePublic().immutable());
		registry.addResourceHandler("/**")
				.addResourceLocations(properties.webRoot())
				.setCacheControl(CacheControl.noCache())
				.resourceChain(false)
				.addResolver(new SpaResourceResolver());
	}

	@Override
	public void addViewControllers(ViewControllerRegistry registry) {
		registry.addViewController("/").setViewName("forward:/index.html");
	}

	private static final class SpaResourceResolver extends PathResourceResolver {

		@Override
		protected Resource getResource(String resourcePath, Resource location) throws IOException {
			Resource resource = super.getResource(resourcePath, location);
			if (resource != null) {
				return resource;
			}
			Resource index = location.createRelative("index.html");
			return index.exists() && index.isReadable() ? index : null;
		}
	}
}
