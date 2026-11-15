# Agenda Università – Pontivi

Agenda delle lezioni di Elisa Pontivi all'Università dell'Insubria, sincronizzata dai calendari pubblici **Cineca University Planner**.

## Come funziona

1. **Fonte.** Tre calendari pubblici Cineca:
   - https://unins.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=6a588a9f4737d600190c6e1a
   - https://unins.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=6a589161be17f20034361fc6
   - https://unins.prod.up.cineca.it/calendarioPubblico/linkCalendarioId=6a5898010fc640018f92fece

   Lo script usa la stessa API pubblica della pagina ufficiale: `POST /api/Impegni/getImpegniCalendarioPubblico` con `linkCalendarioId`, `clienteId` (UNINS = `59f05192a635f443422fe8fd`, da `GET /api/Clienti/cercaPerDominio`), intervallo di date e `mostraImpegniAnnullati: true`. Nessun login, nessun CAPTCHA, 3 richieste ogni 6 ore.
2. **Filtro.** Tiene solo gli impegni con un docente di cognome PONTIVI (anche co-docente).
3. **Unione.** Le partizioni dello stesso insegnamento svolte insieme (stessa ora, stesso docente, es. "Cognomi A-G" e "H-Z") diventano una lezione sola, così le ore non vengono contate due volte.
4. **Confronto.** Ogni lezione ha una UID stabile (`up-<id Cineca>`). Lo script confronta la nuova lettura con `data.json` e registra nello storico: lezioni nuove, spostate, cambi d'aula, annullate (stato Cineca "A") e rimosse.
5. **Robustezza.** Se un calendario non risponde, risponde vuoto o cambia formato, le sue lezioni restano quelle verificate in precedenza (segnate "non aggiornate") e nessuna lezione viene cancellata.
6. **Uscita.** `data.json` (lezioni, stato, storico), `agenda.ics` e `agenda-con-annullate.ics` (iCalendar con UID stabili).

## Dove gira

- **GitHub Actions**: `.github/workflows/agenda-pontivi.yml`, ogni 6 ore (e a richiesta con *Run workflow*). Esegue i test, sincronizza, fa commit dei file in `agenda-pontivi/` e chiede la build di GitHub Pages. Se nessun calendario è raggiungibile il job fallisce e GitHub manda una email.
- **GitHub Pages**: https://elisapontivi.github.io/agenda-pontivi/ è il sito completo (agenda settimanale, giornaliera e mensile, elenco, riepilogo ore, storico) e legge `data.json` aggiornato da Actions. Installabile sulla schermata Home (manifest + service worker). Le conferme "svolta/annullata" sono salvate nel browser del dispositivo.
- Feed iPhone: https://elisapontivi.github.io/agenda-pontivi/agenda.ics (sottoscrizione) e `agenda-con-annullate.ics`.
- Interfaccia: `index.html`, `app.js`, `styles.css`, `sw.js`, `manifest.webmanifest` in `agenda-pontivi/`. La stessa pagina esiste come artifact claude.ai (copia con i dati del 15/11/2026, che rimanda a questo sito).

## Comandi

```
node _sync/test/run-tests.mjs _sync/test/fixtures   # test (dati salvati, nessuna rete)
node _sync/sync.mjs data.json .                     # sincronizzazione reale
```

Fuso orario: Europe/Rome per la visualizzazione; gli orari sono salvati in UTC.
