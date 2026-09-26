# Requisiti di Folume

Questa specifica definisce il comportamento richiesto al prodotto. La guida all'uso e alla configurazione dello stato implementato è nel README.

## Scopo e vincoli

Piccola applicazione web self-hosted per Linux, utilizzabile da browser remoti, per leggere e modificare una directory Markdown. I normali file `.md` sul server sono l'unica fonte autorevole e l'unica persistenza dei documenti.

Non introdurre AI, assistant, chatbot, RAG, agenti, MCP, database, store persistenti dei documenti, client Git, versioning interno, cestino, plugin system o framework applicativi generici. LocalStorage è ammesso soltanto per preferenze UI. Le modifiche effettuate da Git o altri programmi sono normali modifiche filesystem.

Privilegiare semplicità, affidabilità, Markdown portabile, sicurezza dei path, realtime robusto, prevenzione della perdita di dati, poche dipendenze e facilità di self-hosting.

Distribuire Folume con licenza open source MIT, conservando il testo della licenza e l'avviso di copyright nelle distribuzioni del progetto.

## Architettura

- TypeScript, React, Tiptap; Next.js App Router oppure architettura equivalente semplice.
- Backend Node, un unico watcher Chokidar per processo, fan-out via SSE o WebSocket. Nessun polling continuo della sidebar.
- Separare servizio filesystem centralizzato, watcher, trasporto, sessione documento e adapter editor, senza data layer astratti.
- Tutti gli accessi ai documenti e agli asset attraversano il modulo filesystem server-side.
- Flusso letture: filesystem → watcher → realtime → frontend.
- Flusso scritture: Tiptap → serializer Markdown → API → scrittura atomica → filesystem.

## Interfaccia e navigazione

- Due pannelli: albero a sinistra, editor visuale ampio a destra. Nessuna dashboard o homepage complessa.
- Albero con directory annidate, file `.md`, ordinamento naturale con directory prima dei file, selezione del documento corrente, espansione/chiusura preservata quando possibile durante aggiornamenti realtime.
- Sidebar ridimensionabile, tema chiaro/scuro, tipografia leggibile, toolbar discreta, breadcrumb o path corrente e stato del salvataggio.
- Documento rappresentato nell'URL per reload, bookmark e condivisione; validazione del path sempre server-side.
- Shortcut normali di Tiptap per bold, italic, undo/redo; Ctrl/Cmd+S salva immediatamente.
- Modalità source opzionale, subordinata alla semplicità della soluzione.
- Centralizzare in un file di stringhe il copy dell'interfaccia e i messaggi applicativi, compresi errori backend, dialoghi, tooltip ed etichette accessibili. Le modifiche di copy devono poter essere effettuate senza intervenire nella logica; usare chiavi semantiche e placeholder nominati per agevolare le traduzioni future.

## Markdown e asset

- Tiptap visual/WYSIWYG come editor principale, con supporto Markdown ufficiale o libreria open-source mantenuta; nessun parser artigianale.
- Paragrafi, H1–H6, bold, italic, strike, inline code, code block, blockquote, elenchi puntati/numerati/task, link, horizontal rule, hard break, immagini via URL e path compatibili, undo/redo; tabelle tramite extension standard se facilmente disponibili.
- JSON ProseMirror e HTML sono soltanto rappresentazioni runtime. Sul disco rimane Markdown reale e leggibile.
- Mantenere UTF-8 e, quando possibile, newline finale. I link relativi mantengono il significato rispetto al file corrente.
- Le immagini locali passano da un endpoint controllato entro root e per tipi consentiti; non esporre genericamente il filesystem.

## Operazioni e sicurezza filesystem

- Root configurabile con `MARKDOWN_ROOT`; al frontend esporre soltanto path relativi, mai path assoluti del server.
- Root predefinita `./notes`, inclusa nel repository e popolata con file Markdown Lorem ipsum e directory annidate: il primo avvio deve mostrare contenuti utilizzabili. `MARKDOWN_ROOT` consente di scegliere una directory diversa. Le note di esempio sono file reali, modificabili come le altre; non rigenerarle automaticamente o copiarle in una root personalizzata.
- Centralizzare normalizzazione, risoluzione e confinamento dei path. Respingere traversal e tipi non consentiti; non seguire symlink.
- API piccola per tree, lettura, scrittura, creazione file `.md`, creazione directory, rename file/directory, cancellazione file/directory ed eventi.
- Conferma UI per cancellazioni, specialmente directory. Nessuna sovrascrittura silenziosa di destinazioni esistenti nei rename.
- Il rename GUI di un file aperto o della directory che lo contiene aggiorna path, URL e tree mantenendo il documento. Rename esterni possono essere rappresentati come delete + create; il frontend deve tollerarli senza perdere testo locale.
- Autenticazione obbligatoria, semplice e separata dal servizio filesystem: HTTP Basic o delega esplicita a reverse proxy fidato. API di modifica mai accidentalmente pubbliche.

## Salvataggio, revisioni e conflitti

- Lettura restituisce `{ path, content, revision }`; revisione robusta basata su hash del contenuto.
- Scrittura richiede `{ path, content, expectedRevision }`; revisione diversa produce conflitto e non sovrascrive il file.
- Autosave con debounce indicativamente 500–1000 ms; stati Modified, Saving, Saved, Conflict/Error. Nessuna write per ogni carattere.
- Scrittura preferibilmente atomica mediante file temporaneo nella stessa directory e rename.
- Riconoscere le scritture interne con revision/hash e identificativi client/write, senza soppressioni basate su timeout arbitrari. Non provocare loop write → watcher → reload → write.
- Documento clean: modifiche esterne ricaricate automaticamente. Documento dirty: conservare il contenuto locale e mostrare conflitto.
- Permettere ricaricamento esplicito dal disco e mantenimento temporaneo del testo locale; eventuale sovrascrittura solo dopo azione esplicita e nuova verifica della revisione.
- Conflitti, errori, cancellazioni e disconnessioni non devono svuotare il contenuto locale. Non ricaricare un editor dirty senza azione esplicita.
- Non sono richiesti CRDT o editing collaborativo.

## Watcher e performance

- Rilevare creazione, modifica, cancellazione file; creazione/cancellazione directory; rename anche come remove + add.
- Notifiche tipizzate per struttura, contenuto/revisione, cancellazione e rename riconosciuti.
- Un solo watcher server-side per tutti i client. Caricamento contenuto on demand, nessuna rilettura completa delle note a ogni evento o invio di tutti i documenti al browser.
- Albero rigenerabile quando cambia la struttura, con costo ragionevole per centinaia o alcune migliaia di note.
- Segnalare watcher non disponibile; dopo riconnessione riconciliare lo stato senza perdere modifiche locali.
- In container Linux supportare bind mount tramite notifiche native; polling solo come fallback configurabile, non aggressivo.

## Errori, test e deploy

- Gestire file eliminato o rinominato mentre aperto, permission denied, UTF-8 non valido, path errato, revision conflict, write fallita e watcher indisponibile.
- Test solo con directory temporanee: traversal, risoluzione path, symlink, read/write, revisione attesa e conflitti, atomicità, watcher, riconoscimento scritture interne, aggiornamenti esterni di un file aperto clean/dirty.
- Build produzione, variabili ambiente, `.env.example`, host configurabile e istruzioni reverse proxy. Dockerfile consigliato e directory delle note montata come volume.
- Documentazione chiara e snella dello stato attuale; nessun diario di lavoro, log o decisioni aperte nei documenti del prodotto. Appunti operativi e punti aperti in `.work/`.

## Scenario di accettazione prioritario

1. Avviare con una directory Markdown esistente e aprire il browser autenticato.
2. Vedere il tree, aprire `notes/example.md`, modificare una frase nell'editor visuale e verificare l'autosave sul file originale.
3. Modificare lo stesso file con un programma esterno e vedere l'aggiornamento automatico se clean, oppure il conflitto con testo locale preservato se dirty.
4. Creare un `.md` da terminale e vederlo comparire automaticamente.
5. Creare un file dalla GUI e verificarne l'esistenza sul filesystem.
6. Rinominare ed eliminare file e directory mantenendo filesystem e interfaccia coerenti.
