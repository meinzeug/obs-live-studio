# Autonomie-Baseline vom 22. Juli 2026

Erfasst am 22. Juli 2026 um 10:11:13 UTC. Bewertungsfenster: 30 Tage. Die Momentaufnahme enthält ausschließlich
Aggregate und keine Chattexte, Titel, Benutzerdaten oder Secrets.

## Ausgangslage

| Kennzahl                                   |                                Wert |
| ------------------------------------------ | ----------------------------------: |
| Entscheidungen insgesamt / im Fenster      |                             11 / 11 |
| Angewendete Entscheidungen                 |                                   0 |
| Fehlgeschlagen                             |                                   1 |
| Abgelehnt                                  |                                   1 |
| In Überarbeitung                           |                                   2 |
| Durch Revision ersetzt/abgebrochen         |                                   7 |
| Rollbacks                                  |                                   0 |
| Revisionen                                 |                         7 (63,64 %) |
| Mittlere Zeit bis Freigabe/Anwendung       |                  noch nicht messbar |
| Verletzungen von Quorum oder Doppelprüfung |                                   0 |
| Aktive Gremiumsmitglieder                  | 5, über 3 bevorzugte Modellfamilien |
| Aktive Sendeformate                        |                                   1 |
| Geplante Sendungen nächste 24 Stunden      |                                  10 |
| Chatnachrichten letzte 24 Stunden          |                                  25 |
| Als Publikumsimpuls klassifiziert          |                                   1 |
| Fertige Ratsartefakte                      |                                  12 |
| Offene Fehler-/Kritisch-Meldungen          |                                   6 |
| OpenRouter Paid heute                      |        130 Anfragen, 2,07646447 USD |
| OpenRouter reserviert/unsicher             |                           0,507 USD |
| Durch Budget blockiert                     |                         31 Anfragen |

## Interpretation

- Die harte Freigabeinvariante hält: Es existiert keine Entscheidung hinter der Freigabeschranke ohne Quorum und zwei
  unterschiedliche Review-Modelle.
- Der Prozess produziert Entwürfe und Artefakte, hat in dieser Momentaufnahme aber noch keine Entscheidung bis
  `applied` gebracht. Die Erfolgsquote terminaler Entscheidungen ist deshalb 0 %; eine mittlere Freigabe- oder
  Anwendungsdauer wäre statistisch unehrlich und bleibt `nicht messbar`.
- Sieben Revisionen bei elf Entscheidungen zeigen, dass Lösungsgüte und zielgerichtete Überarbeitung die erste
  Optimierungsaufgabe sind. Eine höhere Durchsatzrate darf nicht durch schwächere Prüfungen erkauft werden.
- Nur ein aktives Format liegt unter dem konfigurierten Mindestziel von drei. Formatentwicklung braucht daher einen
  überprüfbaren Produktionspfad, nicht nur weitere Textvorschläge.
- 25 Chatnachrichten führten zu einem formalisierten Publikumsimpuls. Künftige Messung muss unterscheiden zwischen
  sinnvoller Zurückhaltung, Erkennungsfehlern und echten Beteiligungslücken.
- Das Tagesbudget hält technisch, aber 130 Paid-Anfragen und 31 Blockierungen verlangen Kosten pro erfolgreicher
  Entscheidung als zentrale Kennzahl.

## Vergleichskennzahlen für Phase 4

Die folgenden Werte werden mindestens täglich und als gleitendes 30-Tage-Fenster berechnet:

1. Anteil angewendeter Entscheidungen an terminalen Entscheidungen
2. Zeit von Eingang bis Proposal, Quorum, Schlussprüfung, CEO-Entscheidung und Anwendung
3. Revisionen und Modellkosten je angewendeter Entscheidung
4. Anteil der Entscheidungen mit Rollback sowie mittlere Rollback-Zeit
5. Quellenabdeckung und menschliche Korrekturen
6. Formatvielfalt, Wiederholungsquote und Planerfüllung
7. Chat-Erkennung, Reaktionszeit, Deduplikation und angenommene Publikumsimpulse
8. Agenten-/Providerfehler, blockierte Toolaufrufe und Not-Aus-Ereignisse

Die Baseline ist mit `npm run studio:agents:baseline -- --days=30` reproduzierbar. JSON-Ausgabe liefert der zusätzliche
Schalter `--json`.
