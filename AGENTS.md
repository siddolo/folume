# Folume — convenzioni di sviluppo

- Applicazione Markdown filesystem-first: nessun database, AI, store persistente dei documenti o integrazione Git.
- Stack: TypeScript, React/Vite, Tiptap Markdown ufficiale, Node/Express, Chokidar e SSE.
- Tutti gli accessi ai documenti e agli asset passano da `src/server/filesystem/`; i path pubblici sono relativi alla root. Non seguire symlink.
- Un solo watcher per processo. Revisioni SHA-256, scritture atomiche e optimistic concurrency; non sopprimere eventi usando timeout.
- Conservare in memoria il testo locale durante conflitti, errori e cancellazioni. Non ricaricare un editor dirty senza un'azione esplicita.
- Separare filesystem, watcher, trasporto HTTP, sessione documento e adapter editor. Evitare framework interni.
- Autenticazione obbligatoria: Basic oppure delega esplicita a un reverse proxy fidato.
- Testi UI, etichette accessibili, dialoghi e messaggi applicativi appartengono a `src/shared/strings.it.json`, condiviso da frontend e backend. Usare chiavi semantiche e frasi complete con placeholder nominati tramite `formatString`; non concatenare frammenti traducibili né usare il testo tradotto come identificatore logico o classe CSS.
- Test esclusivamente con directory temporanee, mai con note reali. Coprire sicurezza, concorrenza e realtime.
- Comandi: `npm run dev`, `npm run check`, `npm test`, `npm run build`, `npm start`; `npm run test:e2e` per il browser (richiede Chromium Playwright).
- Aggiornare README e `.env.example` quando cambiano configurazione o deploy. Non effettuare commit senza richiesta.

## Documentazione e continuità tra sessioni

- La documentazione prodotta o aggiornata deve descrivere sempre lo stato attuale dell'applicazione. Non usarla per tracciare progressi, cronologie di lavoro, log, decisioni aperte o funzionalità non implementate presentate come disponibili.
- Scrivere documentazione chiara, snella e principalmente rivolta alle persone. Preferire istruzioni verificabili e descrizioni del comportamento effettivo.
- `docs/requirements.md` conserva il contratto dei requisiti del prodotto tra sessioni: consultarlo prima di modifiche significative e aggiornarlo quando l'utente cambia i requisiti. È una specifica, non un elenco di funzionalità già consegnate né un diario di avanzamento.
- Per appunti di lavoro, punti aperti e passaggi di consegne usare esclusivamente `.work/`, separata dalla documentazione del prodotto. Non inserire contenuti di note reali o segreti negli appunti.
