package com.uboatgame_backend.config;

import com.uboatgame_backend.dto.ApiDtos.AuthUser;
import com.uboatgame_backend.service.GameService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;
import tools.jackson.databind.ObjectMapper;

import java.util.Set;

@Component
public class AuthInterceptor implements HandlerInterceptor {
    private static final Set<String> PUBLIC_PATHS = Set.of(
            "/api/login",
            "/api/registration",
            "/api/health"
    );

    private final GameService gameService;
    private final ObjectMapper objectMapper;

    public AuthInterceptor(GameService gameService, ObjectMapper objectMapper) {
        this.gameService = gameService;
        this.objectMapper = objectMapper;
    }

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler) throws Exception {
        if (PUBLIC_PATHS.contains(request.getRequestURI())) {
            return true;
        }
        AuthUser user = gameService.authenticate(request.getHeader("Authorization")).orElse(null);
        if (user == null) {
            response.setStatus(HttpServletResponse.SC_OK);
            response.setContentType("application/json;charset=UTF-8");
            response.getWriter().write(objectMapper.writeValueAsString(GameService.fail("未登录或登录已过期")));
            return false;
        }
        request.setAttribute(GameService.AUTH_ATTR, user);
        return true;
    }
}
