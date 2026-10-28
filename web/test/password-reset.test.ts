import { expect, test } from "bun:test";

test("single-admin login has no registration or password recovery entry", async () => {
    const [loginSource, routerSource] = await Promise.all([Bun.file(new URL("../src/pages/auth/login.tsx", import.meta.url)).text(), Bun.file(new URL("../src/router.tsx", import.meta.url)).text()]);

    expect(loginSource).toContain('label={tr("Password")}');
    expect(loginSource).not.toContain("forgotPasswordURL");
    expect(loginSource).not.toContain("忘记密码");
    expect(routerSource).toContain('{ path: "/forgot-password", element: <Navigate to="/login" replace /> }');
    expect(routerSource).toContain('{ path: "/register", element: <Navigate to="/login" replace /> }');
});
