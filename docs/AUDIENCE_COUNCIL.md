# SENDEGOTT, KI-Sendergremium und Publikumsrat

Der Arbeitsbereich **KI Studio → SENDEGOTT** ist die CEO-Zentrale des autonomen Senders. Dort werden Leitlinien
formuliert, Strategiezyklen angestoßen, Budgets begrenzt, Gremiumsrollen konfiguriert und Entscheidungen mit ihrem
vollständigen Prüfprotokoll angezeigt.

## Einfluss aus dem Livechat

AVA erklärt die Beteiligungsmöglichkeiten im Sprechertext und im Overlay. YouTube- und Twitch-Zuschauer können
folgende Befehle verwenden:

- `!frage …` stellt AVA oder Mia eine konkrete Frage.
- `!thema …` und `!vorschlag …` reichen einen Programmimpuls ein.
- `!einwand …` reicht begründeten Widerspruch ein.
- `!pro …` und `!contra …` ergänzen das dokumentierte Stimmungsbild.

Auch eindeutig beschriftete Beiträge wie `Einwand: …` sowie konservativ erkannte Formulierungen wie „Ich
widerspreche …“ werden erfasst. Gewöhnliche Diskussionen werden nicht automatisch zu einer Senderentscheidung.

## Sicherheits- und Entscheidungsweg

Chattext ist immer nicht vertrauenswürdige Eingabe und kann keine Funktion direkt aufrufen. Der Ablauf ist fest:

1. Sam klassifiziert und dedupliziert den Impuls.
2. Themen und Vorschläge werden zu einem Produktionsvorschlag; Einwände zu einem redaktionellen Prüfauftrag.
3. Fünf getrennte Gremiumsrollen prüfen Redaktion, Publikum, Produktion, Sicherheit und nachhaltiges Wachstum.
4. Das eingestellte Quorum muss zustimmen.
5. Zwei zusätzliche Prüfungen müssen zustimmen und tatsächlich von unterschiedlichen Modellen stammen.
6. Erst danach darf der Worker die freigegebene Änderung innerhalb von Tages- und Anfragelimit anwenden.
7. AVA präsentiert Annahme oder Ablehnung im Livestream und erklärt den Zuschauern das Ergebnis.

Eine PostgreSQL-Constraint verhindert das Überspringen des Quorums oder der beiden Schlussprüfungen auch dann, wenn
ein fehlerhafter Client versuchen sollte, den Status direkt zu ändern. Ab der ersten Gremiumsstimme friert ein zweiter
Datenbank-Trigger außerdem Titel, Anweisung und Umsetzungsvorlage ein. Dadurch kann nach der Prüfung kein anderer
Inhalt unter denselben Freigaben eingeschleust werden. Doppelte Vorschläge werden innerhalb des
konfigurierten Zeitfensters zusammengeführt; Tageslimit und OpenRouter-Budget begrenzen Kosten und Missbrauch.

## Betrieb und Diagnose

Im SENDEGOTT-Arbeitsbereich zeigen Statuskarten offene Publikumsimpulse, Beratungen, Schlussprüfungen, umgesetzte
Beschlüsse, Fehler und das verbleibende Budget. Jede Modellantwort, Abstimmung, Anwendung und Rücknahme bleibt im
Entscheidungsprotokoll nachvollziehbar. Providerfehler erscheinen zusätzlich im Störungszentrum. Transiente
OpenRouter-Providerfehler werden einmal mit neuer Budgetreservierung wiederholt; Modell-Fallbacks bleiben auf drei
Kandidaten begrenzt. Ein Fehler stoppt weder Broadcast noch Autopilot.

Die automatische Umsetzung kann abgeschaltet werden. Dann verbleiben erfolgreich geprüfte Entscheidungen im Status
„Freigegeben“, bis die Senderleitung den Betriebsmodus wieder aktiviert. Bereits angewendete Entscheidungen besitzen
eine kontrollierte Rückrollfunktion; abhängige aktive Entscheidungen müssen dabei zuerst zurückgenommen werden.

## Neue Spezialagenten

Nora, Leo und Kian arbeiten vor dem eigentlichen Gremium als begrenzte Spezialisten. Sie dürfen Informationen sammeln
und Entwürfe formulieren, besitzen aber keine Gremiumsrolle und keine Stimme. Eine explizite Übergabe erzeugt erst eine
normale SENDEGOTT-Entscheidung; Quorum, zwei unabhängige Prüfmodelle und CEO-Freigabe beginnen danach unverändert von
vorn. Capability-Tokens, Langzeit-Memory, Not-Aus und Betrieb sind in
[`AGENT_ORCHESTRATOR.md`](AGENT_ORCHESTRATOR.md) dokumentiert.
