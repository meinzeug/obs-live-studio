# TikTok Shorts Creator

Der Arbeitsbereich **Shorts & Clips → TikTok Shorts Creator** erzeugt aus denselben qualifizierten
„Einordnung mit AVA“-Momenten wie der YouTube Shorts Creator eine eigene 1080 × 1920 Pixel große MP4-Fassung.
Transkript, redaktionelle KI-Analyse und eine echte, nicht als Fallback erzeugte AVA-Einordnung bleiben Pflicht.
Fehler im TikTok-Workflow unterbrechen weder Broadcast, Autopilot noch YouTube-Uploads.

## Trennung von YouTube

- Die redaktionelle Quelle wird nur einmal vorgemerkt, Plattform-Jobs und Veröffentlichungsstatus bleiben getrennt.
- TikTok rendert unter `var/media/shorts/tiktok` eine eigene H.264/AAC-Datei ohne YouTube-PNG oder Sender-Wasserzeichen.
- Tageslimit, Standardtext, Quellpegel und Ducking sind separat einstellbar.
- Das Produktionsjournal erlaubt Vorschau, MP4-Download, Textbearbeitung, Wiederholung, Stopp und lokales Löschen.
- Ein veröffentlichter TikTok-Post wird nicht durch lokales Löschen entfernt; dies erfolgt weiterhin im TikTok-Konto.

## Freigabewarteschlange ohne Developer-App

Dies ist der Standardmodus. Er benötigt weder TikTok-Developer-App noch Client-Key, OAuth oder eine App-Prüfung.
Bei **Mit einem Klick an TikTok übergeben** führt das Studio bewusst gebündelt aus:

1. Beschreibung in die Zwischenablage kopieren,
2. die fertige MP4 als Download starten,
3. `https://www.tiktok.com/upload` in einem eigenen Tab öffnen,
4. die Übergabe mit Zeitstempel und Anzahl im Produktionsjournal protokollieren.

Der Browser darf das Datei-Auswahlfeld einer anderen Webseite aus Sicherheitsgründen nicht automatisch befüllen.
Darum wird die heruntergeladene MP4 im offiziellen TikTok-Uploader einmal ausgewählt; Text, Sichtbarkeit, Rechte und
die Kennzeichnung als KI-generierter Inhalt werden dort kontrolliert und der Post bestätigt. Danach lässt sich der
Auftrag im Studio mit optionaler TikTok-Post-URL als veröffentlicht markieren. Wiederholte Übergaben sind möglich,
ohne einen doppelten Produktionsauftrag anzulegen.

## Optionale offizielle API-Verbindung

Im TikTok Developer Portal werden Login Kit und Content Posting API mit den Scopes `user.info.basic` und
`video.publish` eingerichtet. Die in der WebUI angezeigte Redirect-URI muss exakt hinterlegt sein. Client-Secret,
Open-ID und das rotierende Refresh-Token bleiben in der geschützten lokalen `.env`; sie werden nie an den Browser
zurückgegeben oder geloggt.

```dotenv
TIKTOK_CLIENT_KEY=
TIKTOK_CLIENT_SECRET=
TIKTOK_OAUTH_PROFILE_B64=
TIKTOK_OAUTH_REDIRECT_URI=http://localhost:12001/api/tiktok/oauth/callback
```

`TIKTOK_OAUTH_PROFILE_B64` wird ausschließlich vom Studio geschrieben. Gibt TikTok beim Erneuern ein anderes
Refresh-Token zurück, ersetzt das Studio den alten Wert atomar.

## Veröffentlichungsregeln im API-Modus

Die automatische Produktion kann aktiviert werden, die Veröffentlichung jedoch nicht. Der Dialog ruft unmittelbar
vor jedem Upload `/v2/post/publish/creator_info/query/` auf und zeigt den aktuellen Creator-Namen, die erlaubten
Sichtbarkeiten, Interaktionssperren und die maximale Videolänge. Sichtbarkeit besitzt keinen Vorgabewert; Kommentar,
Duett und Stitch sind standardmäßig aus. Rechte am Ausgangsmaterial, die TikTok Music Usage Confirmation und die
konkrete Veröffentlichung müssen einzeln bestätigt werden. Der Upload wird als KI-generiert (`is_aigc=true`)
gekennzeichnet.

Eine nicht von TikTok geprüfte Content-Posting-App darf ausschließlich `SELF_ONLY` anbieten. Öffentliche Posts werden
in der WebUI erst nach der ausdrücklich gesetzten App-Prüfungsbestätigung freigeschaltet. Auch dann gelten die vom
Creator-Profil gelieferten Optionen und TikToks kontoabhängige Tageslimits.

## API-Übertragung und Status

Der Worker verwendet ausschließlich die dokumentierten Endpunkte:

- OAuth v2 unter `https://open.tiktokapis.com/v2/oauth/token/`,
- Direct Post Init unter `/v2/post/publish/video/init/`,
- sequenzielle `FILE_UPLOAD`-Blöcke mit 5–64 MB und bis zu 128 MB im letzten Block,
- Statusabfrage unter `/v2/post/publish/status/fetch/`.

Zwischenzustände bleiben als `processing` sichtbar. Wiederholbare Netzwerk- und Rate-Limit-Fehler laufen mit Backoff
weiter; endgültige Ablehnungen erscheinen im Produktionsjournal und Störungszentrum. Nach einem Worker-Neustart
werden lokale Render-, Upload- und Statusaufträge kontrolliert wieder aufgenommen.

## TikTok LIVE

TikTok LIVE ist zusätzlich als normales Haupt- oder Mehrfachziel unter **Livestream → Stream & OBS** vorhanden.
Server, Schlüssel und Kanal-URL werden aus dem TikTok LIVE Center eingetragen. Die Ausgabe läuft wie alle parallelen
Ziele über OBS Multiple RTMP Outputs, teilt die Hauptencoder und folgt synchronem Start und Stopp. Es wird keine
inoffizielle API zur Beschaffung eines LIVE-Schlüssels verwendet. RTMPS bleibt die sichere Vorgabe. Falls das TikTok
LIVE Center für das konkrete Konto ausschließlich eine `rtmp://`-Adresse anzeigt, kann die RTMPS-Pflicht im selben
Dialog bewusst deaktiviert werden; die WebUI weist dabei auf die fehlende Transportverschlüsselung hin.
