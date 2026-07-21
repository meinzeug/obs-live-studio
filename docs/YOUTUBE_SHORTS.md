# YouTube Shorts Creator

Der Arbeitsbereich **YouTube Shorts Creator** erzeugt aus qualifizierten Momenten des Formats
„YouTube-Einordnung mit AVA“ vertikale Videos. Ein Auftrag wird nur angelegt, wenn ein echtes zeitcodiertes
Transkript, eine fertige redaktionelle KI-Analyse und eine nicht als Fallback erzeugte AVA-Einordnung vorliegen.
Pro YouTube-Video ist höchstens ein Auftrag möglich; das Tageslimit wird transaktionssicher in der konfigurierten
Zeitzone durchgesetzt.

## Produktionsablauf

1. Der KI-Team-Worker legt nach einer qualifizierten AVA-Einordnung einen Auftrag an.
2. Der unabhängige Shorts-Worker lädt genau den benötigten Quellausschnitt mit `yt-dlp`.
3. Die zentrale TTS-Pipeline vertont AVA. FFmpeg rendert Quelle, AVA-Sprechvideo, AVA-Idle-Loop und das hinterlegte
   transparente PNG zu 1080 × 1920 Pixeln mit exakt 90 Sekunden Laufzeit und AAC-Audio.
4. Der YouTube-Pegel wird während AVAs Einstieg abgesenkt und anschließend auf den eingestellten Short-Pegel
   zurückgesetzt.
5. Nur bei bestätigten Nutzungsrechten und verbundener YouTube-OAuth-Verbindung wird der fertige Short automatisch
   über einen fortsetzbaren Upload übertragen. Ohne Freigabe bleibt er lokal als Vorschau erhalten.

Fehler unterbrechen weder Broadcast noch Autopilot. Sie werden mit Wiederholungszeitpunkt im Störungszentrum und im
Produktionsjournal angezeigt. Abgebrochene oder endgültig fehlgeschlagene Aufträge lassen sich dort erneut starten.

## Zentrale YouTube-Verbindung

Der unter **System → Medien-Engine** gespeicherte `YOUTUBE_DATA_API_KEY` wird automatisch für Recherche, Metadaten,
Kanalquellen und den Shorts Creator wiederverwendet. Er muss im Shorts Creator nicht erneut eingegeben werden.

Google erlaubt mit einem API-Key jedoch keine Aktionen im Namen eines Kanals. Für Uploads und die Erkennung des
eigenen Senderchats muss deshalb zusätzlich einmalig ein OAuth-Webclient angelegt werden. Die in der zentralen
YouTube-Einstellung angezeigte Callback-URL wird als autorisierte Weiterleitungs-URI eingetragen. Client-ID und
Client-Secret werden dort einmal gespeichert; anschließend erteilt der Kanal über Google die Upload-Freigabe. Das
Studio fordert `youtube.readonly`, `youtube.upload` und `youtube.force-ssl` an. Der letzte Scope wird für das
Bearbeiten und Löschen bereits veröffentlichter Shorts benötigt. Client-Secret und widerrufbares Refresh-Token liegen
ausschließlich in der geschützten lokalen `.env`.

```dotenv
YOUTUBE_OAUTH_CLIENT_ID=
YOUTUBE_OAUTH_CLIENT_SECRET=
YOUTUBE_OAUTH_REFRESH_TOKEN=
YOUTUBE_OAUTH_CHANNELS_B64=
YOUTUBE_OAUTH_REDIRECT_URI=http://localhost:12001/api/youtube/oauth/callback
SHORTS_X264_PRESET=medium
SHORTS_X264_CRF=21
```

`YOUTUBE_OAUTH_CHANNELS_B64` wird ausschließlich vom Studio geschrieben. Es enthält die geschützten
OAuth-Profile der freigegebenen Upload-Kanäle und darf weder in den Browser noch in das Repository gelangen.
Weitere Kanäle werden im Shorts Creator über „Weiteren Kanal verbinden“ autorisiert; der konkrete Zielkanal
wird anschließend in den Shorts-Einstellungen ausgewählt.

Der produktive Callback muss HTTPS verwenden. Ein Upload bleibt standardmäßig privat. Vor jedem automatischen Upload
müssen die Rechte am verwendeten Videoausschnitt und an allen Gestaltungselementen ausdrücklich bestätigt werden.

## Betrieb und Diagnose

- `ffmpeg`, `ffprobe` und das konfigurierte `YTDLP_EXECUTABLE` müssen ausführbar sein.
- Das PNG muss transparent und ungefähr 9:16 sein; Uploads werden serverseitig geprüft.
- Fertige Dateien liegen unter `var/media/shorts/output`, temporäre Downloads werden immer entfernt.
- Die WebUI zeigt Renderer, Downloader, Overlay, OAuth und Rechtefreigabe getrennt an.
- Der Worker liest OAuth-Änderungen vor jedem Auftrag neu aus der privaten `.env`.
- Ein unterbrochener YouTube-Upload fragt den serverseitigen Uploadstand ab und setzt am bestätigten Byte fort.
- „YouTube abgleichen“ prüft veröffentlichte IDs gesammelt. Außerhalb des Studios gelöschte Videos werden als fehlend
  markiert, ohne den Creator zu blockieren. Der lokale Auftrag kann danach gelöscht oder mit seiner vorhandenen MP4
  erneut hochgeladen werden.
- Titel, Beschreibung, Tags und Sichtbarkeit lassen sich im Produktionsjournal bearbeiten. Lokales Löschen funktioniert
  auch bei fehlender OAuth-Verbindung; das zusätzliche endgültige Löschen auf YouTube verlangt eine Bestätigung.
