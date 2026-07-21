# OpenRouter-KI im Studio

Stand der Modellprüfung: 21. Juli 2026. Die Integration lädt den aktuellen OpenRouter-Modellkatalog und verwendet
Modellfamilien nur als kontrollierte Kompatibilitätsauswahl für Tests.

## Routing

Jede Aufgabe verwendet eine zweistufige Kaskade:

1. `openrouter/free` wählt aus den aktuell verfügbaren kostenlosen Modellen und filtert nach den benötigten Funktionen,
   insbesondere Structured Outputs.
2. Nur bei einem Fehler, Rate-Limit, einer Moderationsablehnung oder fehlender Modellfähigkeit wird eine getrennte
   Paid-Anfrage vorbereitet. Der nach Intelligence sortierte aktuelle Modellkatalog wird nach Structured Outputs,
   Textausgabe, stabilen Modellversionen, Kontextlänge, Aufgabenpreisgrenze und dem Limit je Anfrage gefiltert.
3. Vor der Paid-Anfrage reserviert PostgreSQL atomar das Einzelanfragelimit im gemeinsamen Tagesbudget. Parallele API-,
   Worker-, Ava- und Mia-Anfragen können die Grenze daher nicht gegenseitig überbuchen.
4. `OPENROUTER_PAID_FALLBACK=false` sperrt alle Paid-Anfragen;
   `OPENROUTER_PRESENTER_PAID_FALLBACK=false` sperrt sie zusätzlich nur für Ava, Mia und die YouTube-Einordnung.

Zusätzlich gelten `provider.require_parameters=true`, eine Preisobergrenze, die gewählte Data-Collection-Regel und ein
striktes JSON-Schema. Inhalte aus Feeds werden im Systemprompt ausdrücklich als Daten und nicht als Anweisungen
behandelt.

## Budget und Modellauswahl

| Variable                             | Standard | Wirkung                                                                |
| ------------------------------------ | -------- | ---------------------------------------------------------------------- |
| `OPENROUTER_DAILY_BUDGET_USD`        | `1.00`   | Gesamtes Paid-Budget pro UTC-Tag über alle Studio-Prozesse.            |
| `OPENROUTER_MAX_REQUEST_USD`         | `0.03`   | Höchstens reservierter und erlaubter Betrag je einzelner Paid-Anfrage. |
| `OPENROUTER_PRESENTER_PAID_FALLBACK` | `true`   | Erlaubt Ava/Mia den budgetierten Fallback nach einem Free-Ausfall.     |

Das Studio bevorzugt aktuell günstige Flash-, Mini-, Haiku-, Qwen-, Mistral-Small- und vergleichbare Textmodelle.
Ein Modell wird nur ausgewählt, wenn sein veröffentlichter Preis mit Sicherheitsmarge in das Einzelanfragelimit passt.
Ist der Modellkatalog nicht prüfbar oder kein Modell bezahlbar, erfolgt keine Paid-Anfrage. Der Vorgang wird im
Störungscenter protokolliert. Fehlende Kostenangaben halten die Reservierung vorsichtshalber bis zum Tageswechsel fest.

OpenRouter liefert das konkret verwendete Modell und die Nutzung zurück. Das Studio speichert diese Modellkennung bei
KI-Zusammenfassungen und im Budgetjournal und zeigt Tagesverbrauch, Reservierungen, Sperren und letztes Modell im
KI-Studio an.

## Sicherheit und redaktionelle Grenzen

- Der API-Key bleibt in der lokalen `.env` mit Modus `0600`; Browser-Antworten enthalten nur einen maskierten Hinweis.
- Ein neuer Key wird vor dem Speichern über `GET /api/v1/key` geprüft.
- Die Originalmeldung wird nicht überschrieben. KI-Texte liegen in Zusammenfassung, Sprechertext und redaktionellen
  Notizen.
- KI-Warnungen werden bei jeder Aufbereitung aus dem Originaltext und der aktuellen KI-Antwort neu aufgebaut. Dadurch
  bleiben keine überholten Hinweise aus älteren KI-Läufen hängen.
- Eine KI-Sendeliste darf ausschließlich bereits freigegebene Artikel-IDs mit geprüftem Video verwenden. Die Liste und
  alle Positionen werden in einer Datenbanktransaktion vollständig oder gar nicht angelegt.
- Interaktive KI-Aufrufe sind standardmäßig auf 30 Anfragen pro Minute begrenzt. Der Wert ist über
  `OPENROUTER_RATE_LIMIT_PER_MINUTE` zwischen 1 und 120 einstellbar.
- OpenRouter-Ausfälle verwerfen keine Eingangsmeldung. TTS und Autopilot behalten die regelbasierte Rückfalllogik.

## Offizielle OpenRouter-Referenzen

- [Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)
- [Latest Model Resolution](https://openrouter.ai/docs/guides/routing/routers/latest-resolution)
- [Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [Provider Routing und Preisgrenzen](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Modellkatalog](https://openrouter.ai/docs/api/api-reference/models/get-models)
- [Aktuellen API-Key prüfen](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
