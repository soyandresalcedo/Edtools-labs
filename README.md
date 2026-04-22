# PhysicsBoard

Claude-powered kinematics tutor that draws on a canvas.

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

