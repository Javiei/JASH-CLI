# 📚 Jash CLI

> **Tu asistente de tareas escolares: Moodle + IA en tu terminal.**

Jash es un CLI instalable globalmente mediante `npm` que se conecta directamente a la plataforma **Moodle** de tu colegio y a tus modelos de IA favoritos (**OpenAI**, **Anthropic Claude**, **Google Gemini** u **Ollama local gratis**) para organizar tus tareas semanales, preparar borradores de alta calidad, notificarte entregas y subir las soluciones automáticamente cuando tú lo apruebes.

Además, cuenta con un servidor **MCP (Model Context Protocol)** integrado para conectarlo a agentes externos como Claude Desktop, Antigravity o Cursor.

---

## ✨ Características Principales

- 👤 **Perfiles de usuario locales directos:** Tus credenciales de Moodle y API keys se almacenan de forma local en tu propia máquina dentro de tu carpeta de usuario (`~/.jash/profiles/<perfil>/`). No se requiere contraseña maestra repetitiva: tu sesión está siempre disponible para tus comandos y automatizaciones.
- 🏫 **Conexión nativa con Moodle:** Utiliza el API oficial de servicios web de Moodle (el mismo que usa la app móvil de Moodle). Detecta cursos, enunciados, adjuntos del profesor, fechas límite y estado de entrega.
- 🤖 **IA multi-proveedor:** Compatible con:
  - **OpenAI** (gpt-4o, gpt-4o-mini o cualquier endpoint compatible como OpenRouter/Groq/LM Studio)
  - **Anthropic Claude** (claude-sonnet-4-5, etc.)
  - **Google Gemini** (gemini-2.5-flash, gemini-1.5-pro, etc.)
  - **Ollama** (modelos locales como llama3, mistral, deepseek; 100% privado y sin costo)
- 📁 **Organización semanal en carpetas:** Organiza automáticamente tus tareas en carpetas limpias:
  ```text
  Documentos/Jash/<perfil>/
  └── Semana 2026-S43/
      └── Historia/
          └── Causas de la Revolución/
              ├── enunciado.md        (enunciado oficial de Moodle)
              ├── adjuntos/           (archivos descargados del profesor)
              ├── borrador.md         (resolución propuesta por la IA)
              ├── notas.md            (supuestos, conceptos clave y puntos a revisar)
              └── entrega/            (archivos finales que tú decides subir)
  ```
- 👁️ **Aprobación antes de subir:** La IA redacta el borrador y notas de estudio, pero **nada se sube sin tu confirmación explícita**. Jash te muestra una vista previa detallada de los archivos o texto en línea antes del envío.
- 🔔 **Recordatorios y Notificaciones nativas:** Alertas visuales y notificaciones de escritorio programables para avisarte de entregas próximas.
- 💬 **Chat interactivo en la terminal:** Conversa con tu asistente sobre tus materias, pide explicaciones de dudas y genera borradores con comandos como `/borrador`, `/tareas` y `/sync`.
- 🔌 **Servidor MCP:** Expone herramientas estándar para que agentes inteligentes controlen Jash de forma segura.

---

## 🚀 Instalación

### 1. Requisitos previos
- [Node.js](https://nodejs.org/) v18.17 o superior (`node -v`).

### 2. Instalación global directa desde GitHub
En cualquier computadora con Node.js instalado, ejecuta directamente:

```bash
npm install -g https://github.com/Javiei/jash.git
```

### 3. Instalación local para desarrollo
Si clonaste o descargaste la carpeta:

```bash
npm install
npm link
```

Una vez enlazado, puedes ejecutar `jash` desde cualquier ventana de PowerShell o terminal:

```bash
jash --help
```

---

## 🛠️ Guía Rápida de Uso

### 1. Registrar tu perfil
Ejecuta el asistente interactivo para configurar tu usuario, tu colegio y tu IA:

```bash
jash registro
```
Te solicitará:
1. Nombre del perfil (ej: `javier`) y contraseña maestra.
2. Dirección Moodle de tu colegio (ej. `aula.micolegio.edu`) y tus credenciales de alumno.
3. Proveedor de IA preferido y su API Key.
4. Carpeta donde deseas que se guarden tus tareas (por defecto `Documentos/Jash/<perfil>`).

### 2. Sincronizar tareas
Descarga todas las materias, tareas pendientes y adjuntos:

```bash
jash sincronizar
# o también:
jash sync
```

### 3. Listar tareas
```bash
# Ver tareas pendientes
jash tareas

# Ver solo las tareas de los próximos 7 días
jash tareas --semana

# Ver todas (incluyendo entregadas)
jash tareas --todas
```

### 4. Generar borradores con IA
```bash
# Modo interactivo (selecciona qué tareas hacer de una lista):
jash borrador

# Hacer automáticamente todas las de la semana:
jash borrador --semana

# Generar para una tarea específica por ID con indicaciones:
jash borrador 95 -i "Enfoque crítico en 500 palabras con bibliografía"
```

### 5. Abrir la carpeta de la tarea
Abre directamente la carpeta en el Explorador de Windows para que revises el enunciado, los adjuntos y edites `borrador.md` o agregues tus PDFs en `entrega/`:

```bash
jash abrir 95
```

### 6. Subir la entrega a Moodle
```bash
# Muestra vista previa y te pide confirmación obligatoria:
jash entregar 95

# Si deseas además enviarla definitivamente para calificar:
jash entregar 95 --final
```

### 7. Recordatorios de entregas
```bash
# Ver entregas que vencen pronto
jash recordatorios

# Programar notificación diaria automática en Windows (ej: 08:00 AM)
jash recordatorios programar --hora 08:00

# Desactivar la notificación diaria
jash recordatorios quitar
```

### 8. Asistente interactivo (Chat)
Inicia una conversación en tiempo real con tu asistente, que ya tiene en contexto tus tareas escolares pendientes:

```bash
jash chat
```
Dentro del chat puedes usar:
- `/tareas` — Ver tus pendientes sin salir del chat.
- `/tarea <id>` — Poner el enunciado de una tarea específica en foco.
- `/borrador <id> [indicaciones]` — Redactar y guardar el borrador en su carpeta.
- `/sync` — Actualizar con Moodle.
- `/salir` — Salir.

---

## 🔌 Conexión MCP (Model Context Protocol)

Jash incluye soporte nativo para el protocolo MCP. Puedes conectarlo con clientes compatibles como **Claude Desktop**, **Antigravity** o **Cursor**.

En la configuración de MCP de tu cliente (ej: `claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "jash": {
      "command": "jash",
      "args": ["mcp"]
    }
  }
}
```

Herramientas MCP expuestas:
- `listar_tareas`
- `sincronizar_moodle`
- `obtener_detalle_tarea`
- `generar_borrador`
- `subir_tarea_moodle`

---

## 👥 Manejo de Múltiples Usuarios

Jash soporta múltiples perfiles en la misma computadora:

```bash
jash perfil lista
jash perfil usar maria
jash perfil eliminar demo
```

---

## 🧪 Pruebas Automatizadas

El proyecto incluye tests unitarios y pruebas de integración:

```bash
npm test
```
