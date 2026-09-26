# Folume - Your files, one quiet place.

Un piccolo editor Markdown via browser, self-hosted e filesystem-first. Sidebar con albero delle note, editor visuale Tiptap, autosave e aggiornamenti live dalle modifiche fatte anche con Vim, VS Code o altri programmi.

I documenti restano normali file `.md` nella directory configurata. Non ci sono database, copie persistenti applicative, AI o integrazione Git.

*WARNING: vibe-coded material.*

## Avvio

Richiede **Linux con `/proc` montato e Node.js ≥ 22.12**. La directory delle note deve essere leggibile e scrivibile dall'utente che esegue Folume. La root predefinita è `./notes`: contiene note Lorem ipsum e cartelle annidate già pronte da aprire e modificare.

```sh
npm ci
cp .env.example .env
```

Modifica `.env`, impostando almeno:

```dotenv
MARKDOWN_ROOT=./notes
AUTH_MODE=basic
AUTH_USER=folume
AUTH_PASSWORD=una-password-lunga-e-personale
HOST=127.0.0.1
PORT=3000
```

Per lo sviluppo:

```sh
npm run dev
```

Per la produzione:

```sh
npm run build
npm start
```

Apri `http://127.0.0.1:3000` e inserisci le credenziali Basic richieste dal browser. Per l'accesso diretto dalla LAN puoi impostare `HOST=0.0.0.0`. Per pubblicazione web usa HTTPS tramite reverse proxy.

Apri **Benvenuto.md** dalla sidebar per iniziare. Per usare i tuoi documenti, cambia `MARKDOWN_ROOT` con una directory esistente, ad esempio `/srv/markdown`. Le note di esempio sono normali file modificabili: non vengono rigenerate né aggiunte automaticamente a directory personalizzate.

## Uso

- Seleziona una nota dalla sidebar. Il path è riportato nell'URL, per esempio `/?file=notes/example.md`.
- Scrivi nell'editor visuale: l'autosave parte dopo **750 ms** dall'ultima modifica. `Ctrl/Cmd+S` salva subito.
- La toolbar supporta H1–H6, grassetto, corsivo, barrato, codice, citazioni, elenchi, task, link, immagini, tabelle, separatori, hard break e undo/redo.
- **Sorgente** permette di modificare direttamente il Markdown. L'apertura e il cambio di modalità non salvano né riscrivono automaticamente il documento.
- `Ctrl/Cmd+click` apre i link: le note relative si aprono nell'editor; i link web in una nuova scheda.
- **+ Nota** e **+ Cartella** creano nella directory selezionata. Il dialogo accetta un path relativo alla root; le directory intermedie devono esistere.
- I pulsanti in basso nella sidebar rinominano o eliminano la selezione. La cancellazione di una directory elimina tutto il suo contenuto, inclusi gli asset, dopo conferma.
- Trascina il divisore per ridimensionare la sidebar, oppure usa le frecce quando ha il focus. Il pulsante sole/luna cambia tema.

Tema, larghezza e cartelle espanse sono le sole informazioni conservate in localStorage. **Il testo non salvato rimane soltanto nella memoria della scheda**; il browser chiede conferma prima di abbandonarlo. In caso di errore o cancellazione puoi anche scaricarlo come `.md`.

### Modifiche esterne e conflitti

Un documento senza modifiche locali si aggiorna automaticamente quando cambia sul server. Se contiene modifiche non salvate, Folume sospende l'autosave e conserva il testo locale.

Le azioni disponibili sono:

- **Mantieni locale**: conserva la versione nella scheda e lascia il salvataggio sospeso.
- **Ricarica dal disco**: sostituisce il testo locale dopo conferma.
- **Sovrascrivi esplicitamente**: rilegge la revisione attuale e tenta il salvataggio; un'ulteriore modifica concorrente produce un nuovo conflitto.

Un rename effettuato da Folume aggiorna il documento aperto e il suo URL anche quando viene spostata una directory. Un rename esterno è trattato come cancellazione e creazione: il nuovo path compare nel tree e il testo del vecchio rimane disponibile nell'editor.

### Markdown e immagini

Parsing e serializzazione sono gestiti da `@tiptap/markdown` ufficiale. Il salvataggio visuale normalizza la formattazione Markdown, per esempio spaziature e marcatori di elenco; non garantisce un roundtrip byte-per-byte. Per sintassi estranee alle extension supportate, come frontmatter o estensioni specifiche di altri editor, usa la modalità sorgente.

I file sono UTF-8; quelli con codifica non valida vengono rifiutati. La scrittura conserva il BOM e la newline finale quando presenti. La modalità visuale usa newline LF.

Le immagini possono usare URL HTTP/HTTPS oppure path relativi alla nota, come `![Schema](../assets/schema.png)`. I riferimenti originali rimangono nel Markdown; soltanto l'URL visualizzato viene risolto tramite `/api/assets`. Sono consentiti PNG, JPEG, GIF, WebP e AVIF, fino a 20 MiB. Nessun upload di asset è previsto. File e directory nascosti, inclusa `.git`, e tutti i symlink sono esclusi.

## Configurazione

| Variabile | Default | Significato |
| --- | --- | --- |
| `MARKDOWN_ROOT` | `./notes` | Directory esistente delle note, relativa alla working directory oppure assoluta; root e antenati non possono essere symlink |
| `HOST` | `127.0.0.1` | Interfaccia di ascolto |
| `PORT` | `3000` | Porta HTTP |
| `AUTH_MODE` | `basic` | `basic` oppure delega esplicita `proxy` |
| `AUTH_USER`, `AUTH_PASSWORD` | obbligatorie in Basic | Credenziali uniche dell'istanza |
| `PUBLIC_ORIGIN` | origin HTTP della richiesta | Origin pubblico esatto, per esempio `https://notes.example.com`; impostarlo se il proxy termina HTTPS |
| `WATCH_USE_POLLING` | `false` | Fallback per mount che non propagano notifiche native |
| `WATCH_POLL_INTERVAL` | `1500` | Intervallo fallback, in millisecondi |
| `MAX_FILE_BYTES` | `5242880` | Dimensione massima di ogni nota, in byte |
| `FOLUME_UID`, `FOLUME_GID` | `1000`, `1000` | Solo Compose: identità Unix con accesso al volume host |

Le credenziali Basic proteggono pagine, API, asset e SSE. Le API mutative verificano anche l'origin e un header applicativo contro richieste cross-site. Il servizio non abilita CORS.

### Reverse proxy

Esempio Caddy con Basic gestita da Folume:

```caddyfile
notes.example.com {
    reverse_proxy 127.0.0.1:3000
}
```

Imposta `PUBLIC_ORIGIN=https://notes.example.com`. Caddy gestisce HTTPS; il backend può restare su loopback. Con nginx disabilita il buffering per `/api/events` (`proxy_buffering off`) e imposta `proxy_read_timeout 60s` o superiore: il server invia un heartbeat ogni 20 secondi.

Con `AUTH_MODE=proxy`, Folume delega **completamente** l'autenticazione al proxy. Usa questa modalità soltanto con un proxy che autentica tutte le richieste, inclusi asset ed eventi, e con il backend non raggiungibile direttamente: loopback o rete Docker privata. Folume non implementa utenti, ruoli o verifica di header d'identità. Il Compose fornito usa Basic.

### Docker

Il file `compose.yaml` monta la directory host indicata in `.env` su `/data/notes` e pubblica la porta soltanto su loopback:

```sh
docker compose up --build -d
```

Senza una root personalizzata, Compose monta `./notes` con gli esempi inclusi. Anche l'immagine Docker contiene gli esempi in `/data/notes`; un bind mount su quel path li sostituisce con i file della directory host.

Per una directory appartenente a un altro utente, imposta `FOLUME_UID` e `FOLUME_GID` ai valori restituiti da `id -u` e `id -g`. I permessi Unix della directory e dei file devono consentire l'accesso. L'applicazione richiede permessi di scrittura sulla directory anche per salvare un file esistente, perché usa un temporaneo e un rename.

Su bind mount Linux viene usato il watcher nativo. Per mount di rete o ambienti che non inoltrano gli eventi, abilita esplicitamente `WATCH_USE_POLLING=true`; il frontend continua a ricevere SSE, senza polling browser.

## Architettura e API

```text
src/app/                       React, API client, sessione documento
src/components/FileTree/       Albero e stato di espansione
src/components/MarkdownEditor/ Adapter Tiptap/Markdown e riferimenti relativi
src/components/EditorToolbar/  Comandi di formattazione
src/server/filesystem/         Path, letture, scritture atomiche e asset
src/server/watcher/            Unico Chokidar e fan-out degli eventi
src/server/http.ts             API Express e SSE
src/server/auth.ts             Basic e protezione delle richieste mutative
src/shared/                    Contratti tipizzati
```

**Letture:** filesystem → watcher → SSE → tree/editor. Il watcher legge il contenuto soltanto dei file interessati dagli eventi; il tree contiene nomi e path relativi, non i documenti.

**Scritture:** Tiptap → serializer Markdown → API → temporaneo nella stessa directory → `fsync` → rename → filesystem. Vengono conservati i bit di permesso del file; proprietario, ACL e attributi estesi del vecchio inode non vengono replicati.

Ogni revisione è uno SHA-256 dei byte. Le mutazioni applicative sono serializzate e la revisione viene ricontrollata prima del rename. Il watcher riconosce le scritture interne tramite hash, client e write ID; gli eventi duplicati vengono confrontati per revisione. Gli eventi nativi di Chokidar vengono riconciliati anche quando il suo livello alto accorpa modifiche ravvicinate. Nessun timeout viene usato per ignorare scritture proprie.

Le operazioni sui path usano directory aperte e ancorate tramite `/proc/self/fd` e `O_NOFOLLOW`. Questo è il motivo del requisito Linux. I processi esterni restano indipendenti: il filesystem POSIX non offre un compare-and-swap fra controllo del contenuto e rename. Rimane quindi una finestra molto piccola per una scrittura esterna esattamente simultanea; Folume non è un sistema di editing collaborativo o di backup. Esegui una sola istanza sulla stessa root per mantenere la serializzazione delle mutazioni applicative.

| Metodo | Endpoint | Uso |
| --- | --- | --- |
| GET | `/api/files/tree` | Albero relativo alla root |
| GET | `/api/files/content?path=…` | `{ path, content, revision }` |
| PUT | `/api/files/content` | `{ path, content, expectedRevision, clientId, writeId }`; documento salvato in risposta |
| POST | `/api/files` | `{ path }`, nuovo `.md` |
| POST | `/api/directories` | `{ path }`, nuova directory |
| PATCH | `/api/files/rename` | `{ oldPath, newPath }` |
| DELETE | `/api/files` | `{ path }`, eliminazione definitiva |
| GET | `/api/assets?path=…` | Immagine locale consentita |
| GET | `/api/events` | Stream SSE tipizzato |

Le richieste mutative richiedono JSON e `X-Folume-Request: 1`. Gli errori restituiscono `{ error, code }`; una revisione non corrispondente restituisce HTTP 409 con `code: "CONFLICT"`.

Alla riconnessione SSE il browser rilegge tree e documento aperto. Un watcher in errore viene segnalato nell'interfaccia: controlla i log del processo e riavvia il servizio dopo aver risolto il problema.

## Testi e copy

Il catalogo condiviso da frontend e backend è **`src/shared/strings.it.json`**. Contiene testi dell'interfaccia, tooltip, etichette accessibili, dialoghi, stati di salvataggio, errori e messaggi di configurazione. È organizzato per area (`sidebar`, `workspace`, `toolbar`, `errors`, ecc.); per cambiare il copy modifica i valori mantenendo le chiavi.

I testi dinamici usano placeholder nominati, per esempio `Eliminare definitivamente “{path}”?` o `Titolo {level}`. Conserva i nomi dei placeholder; puoi spostarli liberamente nella frase. Usa testo semplice, senza HTML; `\n` separa le righe nella descrizione della schermata vuota. Nei nomi predefiniti dei file conserva l'estensione `.md`.

`src/shared/strings.ts` esporta il catalogo italiano attivo e la funzione `formatString` per i parametri. Anche titolo e lingua della pagina vengono ricavati dal catalogo. I codici API e gli identificatori degli stati rimangono indipendenti dal copy. In produzione applica le modifiche con una nuova build e il riavvio del servizio; per Docker ricostruisci l'immagine.

## Verifiche e documentazione

```sh
npm run check
npm test
npm run build
npx playwright install chromium
npm run test:e2e
# Opzionale: richiede Docker, costruisce folume:local e usa un bind mount temporaneo.
npm run test:docker
```

I test usano esclusivamente directory temporanee. Coprono path e symlink, UTF-8, atomicità, concorrenza, API/autenticazione, watcher nativo e polling, eventi interni, Markdown roundtrip e sessioni clean/dirty. I test browser avviano la build di produzione e verificano apertura, autosave, aggiornamenti esterni, CRUD, conflitti e immagini locali. Il test Docker verifica autenticazione, salvataggio atomico e notifiche native per modifiche e creazioni effettuate dall'host sul bind mount.

I requisiti di prodotto sono in [`docs/requirements.md`](docs/requirements.md); le convenzioni di sviluppo in [`AGENTS.md`](AGENTS.md). `.work/` è riservata agli appunti operativi, separati dalla documentazione del prodotto.
