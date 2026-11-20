# Timeouts de sesión

CrediFlux aplica **dos límites** a la sesión del usuario:

| Límite | Valor | Ordenador |
| --- | --- | --- |
| Inactividad | 30 minutos | Frontend (`app/page.jsx`, `idleTimeout`) y Supabase Auth |
| Duración absoluta (timebox) | 24 horas | Frontend (`app/page.jsx`, `absoluteTimeout`) y Supabase Auth |

El frontend cierra la sesión localmente al cumplir cualquiera de los dos. Supabase Auth debe configurarse con los mismos valores para que el token no siga siendo válido después del cierre local.

## Entorno local

`supabase/config.toml` contiene la configuración que usa `supabase start`:

```toml
[auth.sessions]
timebox = "24h"
inactivity_timeout = "30m"
```

## Proyecto hosted (producción)

`supabase/config.toml` **no se aplica** a proyectos hosted. Configurar manualmente:

1. Abrir el dashboard del proyecto → **Authentication → Settings → Sessions**.
2. **Time-box user sessions** (o *Session timebox*) = `24h`.
3. **Inactivity timeout** = `30m`.
4. Guardar los cambios.

> Esta función está disponible en planes **Pro o superiores**. Si el plan no la incluye, el frontend seguirá cerrando la sesión localmente, pero el refresh token de Supabase puede permanecer válido.

### Consideraciones

- La expiración se comprueba **la próxima vez que se refresca la sesión**, no de forma proactiva: una sesión vencida puede seguir "activa" en la tabla `auth.sessions` hasta su limpieza (aprox. 24 h después).
- El tiempo efectivo es **`timeout configurado + expiración del JWT`**. Con el JWT por defecto de 1 h, el cierre real puede ocurrir hasta ~1 h después del valor configurado. No bajar el JWT de 5 minutos; aumentarlo agrava el desfase.
- Tras cambiar los valores, las sesiones existentes no se terminan de inmediato: se irán cerrando a medida que se refresquen.

## Verificación

1. Iniciar sesión con un operador y dejar la pestaña inactiva más de 30 minutos → al volver, debe pedir login.
2. Forzar un refresh de sesión (recargar la página tras el tiempo de inactividad) y comprobar que `/api/*` responde `401`.
3. En el dashboard, revisar `auth.sessions`: la sesión del usuario debe quedar expirada/revocada tras el refresh posterior al timeout.
4. Repetir con una sesión activa continua de más de 24 h para validar el timebox.

## Referencias

- [Supabase Auth — User sessions](https://supabase.com/docs/guides/auth/sessions)
- [`supabase/config.toml`](../supabase/config.toml) (solo entorno local)
