# OpenRouter-KI im Studio

Stand der Modellprüfung: 16. Juli 2026. Die Integration verwendet bewusst Modellfamilien statt schnell veraltender
Versionsnummern. OpenRouters `~latest`-Auflösung zeigt im API-Ergebnis weiterhin das tatsächlich verwendete Modell an.

## Routing

Jede Aufgabe sendet eine priorisierte Modellliste:

1. `openrouter/free` wählt aus den aktuell verfügbaren kostenlosen Modellen und filtert nach den benötigten Funktionen,
   insbesondere Structured Outputs.
2. Nur bei einem Fehler, Rate-Limit, einer Moderationsablehnung oder fehlender Modellfähigkeit folgen die bezahlten
   Modelle der jeweiligen Aufgabe.
3. `OPENROUTER_PAID_FALLBACK=false` entfernt alle bezahlten Modelle aus der Liste.

Zusätzlich gelten `provider.require_parameters=true`, eine Preisobergrenze, die gewählte Data-Collection-Regel und ein
striktes JSON-Schema. Inhalte aus Feeds werden im Systemprompt ausdrücklich als Daten und nicht als Anweisungen
behandelt.

## Aufgaben und Modellfamilien

| Aufgabe      | Bezahlte Fallbacks nach `openrouter/free`                                                  | Begründung                                                                                          |
| ------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Redaktion    | `~anthropic/claude-sonnet-latest`, `~google/gemini-flash-latest`                           | Sonnet für nuanciertes Umschreiben und Einordnen; Flash als schneller, langkontextfähiger Fallback. |
| Quellen      | `~anthropic/claude-haiku-latest`, `~openai/gpt-mini-latest`, `~google/gemini-flash-latest` | Kleine strukturierte Klassifikation mit niedriger Latenz und begrenzten Kosten.                     |
| Sendeliste   | `~anthropic/claude-sonnet-latest`, `~google/gemini-pro-latest`                             | Mehrschrittige Auswahl und dramaturgische Reihenfolge benötigen stärkere Planung.                   |
| Overlay-Text | `~anthropic/claude-haiku-latest`, `~google/gemini-flash-latest`                            | Kurze redaktionelle Formulierung ohne unnötig teures Langdenken.                                    |

OpenRouter liefert das konkret verwendete Modell und die Nutzung zurück. Das Studio speichert diese Modellkennung bei
KI-Zusammenfassungen und zeigt sie in der Beitragsansicht an.

## Sicherheit und redaktionelle Grenzen

- Der API-Key bleibt in der lokalen `.env` mit Modus `0600`; Browser-Antworten enthalten nur einen maskierten Hinweis.
- Ein neuer Key wird vor dem Speichern über `GET /api/v1/key` geprüft.
- Die Originalmeldung wird nicht überschrieben. KI-Texte liegen in Zusammenfassung, Sprechertext und redaktionellen
  Notizen.
- KI-Warnungen werden mit vorhandenen regelbasierten Warnungen zusammengeführt und verhindern keine manuelle Prüfung.
- Eine KI-Sendeliste darf ausschließlich bereits freigegebene Artikel-IDs verwenden; unbekannte IDs werden verworfen.
- OpenRouter-Ausfälle verwerfen keine Eingangsmeldung. TTS und Autopilot behalten die regelbasierte Rückfalllogik.

## Offizielle OpenRouter-Referenzen

- [Free Models Router](https://openrouter.ai/docs/guides/routing/routers/free-router)
- [Latest Model Resolution](https://openrouter.ai/docs/guides/routing/routers/latest-resolution)
- [Model Fallbacks](https://openrouter.ai/docs/guides/routing/model-fallbacks)
- [Structured Outputs](https://openrouter.ai/docs/guides/features/structured-outputs)
- [Provider Routing und Preisgrenzen](https://openrouter.ai/docs/guides/routing/provider-selection)
- [Aktuellen API-Key prüfen](https://openrouter.ai/docs/api/api-reference/api-keys/get-current-key)
