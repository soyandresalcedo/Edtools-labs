# PhysicsBoard

Claude-powered kinematics tutor that draws on a canvas.

## Lección del Día 2 (captions sincronizados)

Opus usa la tool **`speak`** (Speech Variant): una frase corta antes de cada
grupo de dibujos. El cliente muestra ese texto como caption y espera un tiempo
proporcional al largo antes del siguiente trazo. La narración libre fuera de
tools no se muestra (solo `speak` + herramientas de dibujo).

Atajos en la UI: chips de preguntas preset y **Nueva lección**.

## Development

```bash
pnpm install
pnpm dev
```

## Demo sin API (DEMO_MODE)

Para probar la UI sin `ANTHROPIC_API_KEY`, crea `.env.local`:

```env
DEMO_MODE=1
```

- Pregunta genérica (p. ej. “¿Qué es la velocidad?”) → escena 1 (v vs a).
- Pregunta con **MRU**, **movimiento rectilíneo uniforme**, **gráfica posición–tiempo**, etc. → escena 2 (ejes + recta \(x(t)\)).

## License

MIT

