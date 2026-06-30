---
id: 3196
slug: "einstieg-in-obs-ein-leitfaden-fur-anfanger"
path: "/youtube-tipps-de/einstieg-in-obs-ein-leitfaden-fur-anfanger/"
title: "Einstieg in OBS: Ein Leitfaden für Anfänger"
excerpt: "Erlernen Sie die Grundlagen von OBS für die Aufnahme und den Stream, von Szenen und Quellen bis hin zur Audioeinstellung, Auflösung und Vorbereitung des ersten Streams."
date: "2022-10-24T16:34:05"
modified: "2025-01-30T10:48:05"
locale: "de"
translationKey: "post:2275"
categoryIds: [17]
image: "https://lh5.googleusercontent.com/s9rkISe0KpvpU_IC2a_CnpznbTIxp41h7ojyWIroeD0bmY3xwCUpdTnh-uOgGAiGcIojmZmxcA4tsgoIZzOpCwiAw7Zmq7tmhAWxOSArIctQ2-DDZR4xYpiZjIG0vhOfCTzW-SflST-cOLeI2ps7te9j_8B8291CgAltZdglZJfo7XmXFSijFjVu_w"
authorName: "Leo Wattenberg"
sourceUrl: "https://kw.media/youtube-tips-en/getting-started-with-obs-a-beginners-guide/"
---

*OBS ist ein fantastisches Tool für Creator, wenn du live streamen, Videos aufnehmen oder sogar beides gleichzeitig machen möchtest. Dieser Leitfaden konzentriert sich auf Tipps für Anfänger, während ein späterer Leitfaden fortgeschrittenere Ratschläge zur Verwendung von OBS und dem YouTube Live Dashboard geben wird.*

<figure><div>
<div class="nv-iframe-embed"><iframe title="Wie man OBS Studio verwendet - OBS Studio QUICKSTART Tutorial für Anfänger (2025)" width="1200" height="675" src="https://www.youtube.com/embed/UYYrZnRHVHI?feature=oembed" frameborder="0" allow="Beschleunigungsmesser; automatisches Abspielen; Clipboard-Schreiben; verschlüsselte Medien; Gyroskop; Bild-im-Bild; Web-Freigabe" allowfullscreen></iframe></div>
</div></figure>

Wenn du OBS noch nicht heruntergeladen hast, kannst du es von [der offiziellen Website](https://obsproject.com/) herunterladen. Nachdem du es installiert hast, sollte es eine automatische Konfiguration geben. Du kannst ihr folgen, um eine einigermaßen sinnvolle Grundeinstellung zu erhalten, aber früher oder später wirst du trotzdem in die Einstellungen gehen müssen, die wir hier vorstellen, um das volle Potenzial von OBS freizuschalten.

## Zu Bitraten, Frameraten und Auflösungen

Beim Streaming ist dein größtes Hindernis wahrscheinlich deine **Upload-Geschwindigkeit**. In vielen Fällen ist die Upload-Geschwindigkeit nur ein kleiner Bruchteil (10-20%) deiner Download-Geschwindigkeit. Daher solltest du vor dem Streamen deine Geschwindigkeit testen. Du kannst einige der folgenden Dienste ausprobieren, um eine Schätzung zu erhalten:

- [speedtest.net](https://www.speedtest.net/)
- [speedof.me](https://speedof.me/)

Sobald du dein Ergebnis hast, überprüfe die Tabelle in [YouTube's Bitrate- und Auflösungsleitfaden](https://support.google.com/youtube/answer/2853702) und sieh dir an, welche Auflösungen zu deiner Bandbreite passen. Dann gehe in OBS zu **Einstellungen → Video**, um die Auflösung einzustellen, und **Einstellungen → Ausgabe**, um die gewünschte Bitrate festzulegen.

Stelle sicher, dass du den Ausgabemodus auf „**Erweitert**“ setzt.

<figure><img src="https://lh5.googleusercontent.com/s9rkISe0KpvpU_IC2a_CnpznbTIxp41h7ojyWIroeD0bmY3xwCUpdTnh-uOgGAiGcIojmZmxcA4tsgoIZzOpCwiAw7Zmq7tmhAWxOSArIctQ2-DDZR4xYpiZjIG0vhOfCTzW-SflST-cOLeI2ps7te9j_8B8291CgAltZdglZJfo7XmXFSijFjVu_w" alt><figcaption>Du kannst die Videoauflösung und Framerate in den Videoeinstellungen festlegen.</figcaption></figure>

<figure><img src="https://lh4.googleusercontent.com/sHtLlRJTtg4n1fTHv2fNpZWrmKVgZsZc-JdBitbgbpdcZxvyfFlAllgChy-wXPza_SzJnZH0qyZqiQIvoa6BLj-U0gS3hq9R_AvlQ5-XsnxhvzDg2nyn6peXx8FMIe7t_yO_5TnfOPyuN_5fa7VS3HQfhJ5TXaGZIh2O-n6TQMsZvJnQIbwyXXGZtw" alt="Das Fenster zeigt die Encoder-Einstellungen für das Streaming. Es ist auf VBR (variable Bitrate) zwischen 25000 mbps und 27000 mbps eingestellt." title="OBS Ausgabe-Einstellungen Menü"><figcaption>Du kannst die Bitrate in den Ausgabeeinstellungen sowohl für das Streaming als auch für die Aufnahme festlegen.</figcaption></figure>

**Hinweis:** Stelle sicher, dass du etwas **Puffer** lässt, damit du während des Streamings noch Bandbreite für Online-Spiele, Discord und natürliche Schwankungen der Upload-Geschwindigkeit zur Verfügung hast.

### Beispiel

Nehmen wir an, mein Internet kann 25.000 kbit/s Download und 5.000 kbit/s Upload erreichen. Ich ziehe etwas Puffer ab und weiß, dass ich wahrscheinlich zwischen 4.000 und 4.500 kbit/s für meinen Stream zur Verfügung habe. Im [YouTube-Leitfaden](https://support.google.com/youtube/answer/2853702) sehe ich zwei Optionen, die gut zu mir passen:

- **720p, 60 fps** – 2.250 kbit/s bis 6.000 kbit/s: Dies würde mir ein flüssiges 60 fps Streaming mit der bestmöglichen Qualität für 720p bieten. Diese Einstellung wäre ideal für schnelle Shooter wie Apex Legends.
- **1080p, 30 fps** – 3.000 kbit/s bis 6.000 kbit/s: Dies würde eine höhere Auflösung bieten und trotzdem flüssig genug sein. Für langsamere ("kinematische") Spiele, Strategiespiele und insbesondere Point'n'Click-Spiele und "nur reden"-Streams ist diese Einstellung gut geeignet. Bei schnelleren Spielen wird es wahrscheinlich sehr unscharf werden.
- Die nächste Option scheint gerade so zu passen, aber es ist wahrscheinlich keine gute Idee, sie zu verwenden: **1080p, 60 fps** – 4.500 kbit/s bis 9.000 kbit/s: Bei dieser Rate bin ich sehr nah an dem, was mein Internet maximal leisten kann, und obwohl ein solcher Stream möglich wäre, wird das Ergebnis wahrscheinlich schlechter sein als bei den obigen Optionen. Im Vergleich zu 1080p, 30fps, muss jeder Bit, den du jetzt streamst, doppelt so viele Pixel bedienen, sodass die Qualität aller Bilder ziemlich reduziert wird. Und im Vergleich zu 720p60 wirst du wahrscheinlich eine sehr ähnliche **Qualität** haben.

Nochmals: All das geht davon aus, dass meine Internet-Upload-Geschwindigkeit maximal 5.000 kbit/s erreichen kann.

**Wenn du nicht streamst**, kannst du theoretisch die Bitrate für deine Aufnahmen so hoch wie gewünscht einstellen. In der Praxis ist es jedoch sinnvoll, [YouTube's Leitfaden zu Bitraten für Uploads](https://support.google.com/youtube/answer/1722171) (die etwas höher sind als Streaming-Raten) zu befolgen, um die Dateigrößen im Zaum zu halten:

- 1 Stunde bei 8.000 kbit/s (empfohlen für 720p60 und 1080p) benötigt 3,6 GB
- 1 Stunde bei 12.000 kbit/s (empfohlen für 1080p60) benötigt 5,4 GB
- 1 Stunde bei 60.000 kbit/s (empfohlen für 4K60) benötigt 27 GB.

Was die Auflösung betrifft, gelten die gleichen Empfehlungen wie oben: Wenn eine Auflösung zu hoch für deine Bitrate ist (z. B. 8.000 kbit/s für ein 1080p60-Video), wird das Video unscharf. Und wenn du eine Bitrate verwendest, die für deine Auflösung zu hoch ist, erhöhst du nur unnötig die Dateigröße.

## Videos aufnehmen

Wenn du Videos aufnimmst, musst du nur angeben, wo du deine Aufnahmen in den **Einstellungen → Ausgabe** von OBS speichern möchtest (standardmäßig wird das Heimatverzeichnis ausgewählt). Dort legst du auch die gewünschte Qualität fest (Hohe Qualität, mittlere Dateigröße sollte wahrscheinlich ausreichen; wenn du höhere Einstellungen wählst, stelle sicher, dass deine Festplatte schnell genug schreiben kann und genügend Speicherplatz hat).

<figure><img src="https://lh6.googleusercontent.com/jyG0KrUlpzHjHRyBaj5FFwrs_EjuXHW9oI_er3_JhzB_XdXwkxPNRimOAfKGvxJYL2oPzl75pUcCesv0Z4A9r50h3UPX2G24tK20ptkEJPK0zIFVRYciv2et4X4ovR1JD_i7c03rcgZQYpNIjCUBqfVtLylbLI4GjPwLjC-xBJ1hwVunkj5gJtlibA" alt><figcaption>Du kannst das Aufnahmedverzeichnis in den Ausgabe-Einstellungen ändern.</figcaption></figure>

Als Aufnahmformat kannst du entweder **mkv** wählen, was den Vorteil hat, dass es bei einem Absturz oder Bluescreen überlebt, aber der Nachteil ist, dass einige Videobearbeitungssoftware damit nicht gut zurechtkommt – oder **mp4** oder **mov**. Diese Formate haben es umgekehrt; sie werden von fast allem unterstützt, aber sie werden bei einem Fehler vollständig korrupt sein. Wenn du genug Festplattenspeicher hast, kannst du in mkv aufnehmen und sie dann remuxen (entweder automatisch mit OBS oder mit Tools wie [handbrake](https://handbrake.fr/)) in ein Format, das deine Bearbeitungssoftware unterstützt.

Unabhängig davon gibt es zwei Einstellungen, die wahrscheinlich nützlich für dich sind:

- In **OBS → Einstellungen → Ausgabe** solltest du einen Hardware-Encoder verwenden, es sei denn, du hast eine sehr hochwertige CPU. Insbesondere Nvidias NVENC ist sehr gut in seiner Aufgabe. Wenn du noch keine GPU (oder nicht einmal einen PC) hast, solltest du unseren [Einstieg mit kleinem Budget](https://www.reddit.com/r/youtubegaming/comments/hbdknw/starting_a_gaming_channel_on_a_budget/)-Leitfaden konsultieren.
- In **OBS → Einstellungen → Erweitert** kannst du den Farbraum auf 709 (601 wurde für 480i-Inhalte entwickelt) und den Farbbereich auf "voll" ("begrenzt" wird hauptsächlich [für TV-Inhalte](https://referencehometheater.com/2014/commentary/rgb-full-vs-limited/) verwendet) einstellen.

<figure><img src="https://lh4.googleusercontent.com/sHtLlRJTtg4n1fTHv2fNpZWrmKVgZsZc-JdBitbgbpdcZxvyfFlAllgChy-wXPza_SzJnZH0qyZqiQIvoa6BLj-U0gS3hq9R_AvlQ5-XsnxhvzDg2nyn6peXx8FMIe7t_yO_5TnfOPyuN_5fa7VS3HQfhJ5TXaGZIh2O-n6TQMsZvJnQIbwyXXGZtw" alt><figcaption>Stelle sicher, dass du den Encoder wählst, der zu deinen Bedürfnissen und deiner Hardware passt…</figcaption></figure>

<figure><img src="https://lh3.googleusercontent.com/8Oca6VLEsriuN1K2mpoPmYMkrfJPRbiTHP5JAu-dTGijQA-9s8Fi81xAEK3icOOaSz77O2l67SGOyD1diEHkuKBj8Jw4UyJgGuQ94pTh4Tcd5aAJ-XWlRqxVZAzBoQRThY4JCCbOdnAToE74MRPUjT1BMsvuGDD_d0Xnthwwjt7wgvB1Es7t3lJEQQ" alt><figcaption>— und wähle den richtigen Farbraum.</figcaption></figure>

## Szenen und Quellen

Jetzt haben wir also die verschiedenen Dinge eingerichtet, die zum Streamen und Aufnehmen benötigt werden, außer dem, was dich wahrscheinlich am meisten interessiert: ***Was ist eigentlich auf dem Video oder im Stream zu sehen?!*** Dafür benötigst du Szenen und Quellen.

Eine Quelle ist eine Beschreibung eines (Bild-)Eingangs. Eine Szene ist eine Sammlung von Quellen, die bereits geordnet sind, sodass du schnell zwischen ihnen wechseln kannst.

Im Allgemeinen ist es nützlich, folgende Szenen bereit zu haben:

- Deine normale Aufnahm-/Streaming-Szene, die wahrscheinlich deine Webcam und das Spiel zeigt
- Eine Webcam-nur-Szene, damit du einfach mit deinem Chat sprechen kannst, während du etwas einrichtest, oder um ein Vlog-ähnliches Video aufzunehmen
- Eine Pause/Technische Schwierigkeiten-Szene, falls etwas schiefgeht und du schnell von dem wechseln musst, was du normalerweise zeigen würdest, oder du einfach eine Pause machen möchtest.

<figure><img src="https://lh5.googleusercontent.com/Z0Upu5TGWyrNEfAkiLaNMvdJwoqcCu0vZutcxGMRPUIQixYEfdN69WCE_1hFYKRlZA_NfWBO53a2Kxkqi6kvsR8OMFhW5DOLbeDk3oxpcAel9k0JV_tDl0anqJ0yT8Je0eIltn4EHzwfrT3ZN4OKI18C2z3ip8BaNHl5VmEYaAkVWclJU1X4uwJzOA" alt><figcaption>Das Hinzufügen einer Szene ist so einfach wie das Drücken der + Taste in der unteren linken Ecke.</figcaption></figure>

Jetzt, da du deine Szenen hast, fügen wir ihnen Quellen hinzu!

**Hinweis:** Deine Quellen werden in einer Schichtstapel angezeigt. Das bedeutet, dass die Quelle ganz oben im Stapel über allen darunter liegenden angezeigt wird. Wenn du deine Quelle nicht finden kannst, überprüfe, ob sie weit genug oben im Stapel steht oder ob sie durch eines der darüber liegenden Elemente verdeckt wird!

- Um Ihre Webcam/externen HDMI-Recorder hinzuzufügen, fügen Sie ein [Videoerfassungsgerät](https://obsproject.com/wiki/Sources-Guide#video-capture-device) hinzu.
- Um ein Spiel aufzunehmen, fügen Sie eine [Spieleerfassung](https://obsproject.com/wiki/Sources-Guide#game-capture) hinzu. Sie können dies so einrichten, dass es immer eine Vollbildanwendung erfasst, oder, wenn Sie nicht im Vollbildmodus laufen, angeben, welchen Fenstertitel Sie erfassen möchten. Die Spieleerfassung ist Ihre beste Wahl, um die meisten Dinge aufzunehmen. Wenn die Spieleerfassung nicht funktioniert, sollten Sie möglicherweise die Verwendung einer [Fenstererfassung](https://obsproject.com/wiki/Sources-Guide#window-capture) oder der [Anzeigenerfassung](https://obsproject.com/wiki/Sources-Guide#display-capture) in Betracht ziehen. Beachten Sie, dass die Anzeigenerfassung alles anzeigt, was auf dem Bildschirm angezeigt wird: Peinliche Benachrichtigungen, Fotos und Passwörter eingeschlossen. Fenster- und Spieleerfassung sind Ihre besseren Optionen.
- Um statische Elemente wie einen Stream-Overlay oder Text hinzuzufügen, fügen Sie eine Bildquelle (für statische Bilder), eine Medienquelle (für Videos und Sounds) oder eine Textquelle (raten Sie mal, was das tut) hinzu.
- Sie können Ihren Quellen Filter hinzufügen, die es Ihnen beispielsweise ermöglichen, in OBS selbst eine Greenscreen-Erfassung einzurichten.

Alternativ können Sie PCIe-Erfassungskarten wie die [AverMedia GC573](https://amzn.to/3MeEBjl) oder [Elgato 4K60 Pro MK.2](https://www.amazon.com/-/de/dp/B09M2Z8GJZ) verwenden, um ein HDMI-Signal entweder als Duplikat dessen, was an Ihren Bildschirm gesendet wird, oder als externen Eingang von einer DSLR oder Spielkonsole zu erfassen.

Sie können Ihre Quellen auf dem Bildschirm verschieben, indem Sie sie einfach mit der Maus ziehen. Durch Klicken auf die Kanten skalieren Sie sie, während das Seitenverhältnis beibehalten wird, und durch Alt-Klicken in den Ecken können Sie Dinge verzerrt darstellen.

<figure><img src="https://lh6.googleusercontent.com/r8sHs60CCUMmOA_ljcJaRmMrEa0sqmOTBHjXfXLfDULnsYAJhjaDJKzRD3l8eOvy6bFdPyExOuD8pNfX5g-DSrSVNNq8c0w4qCQ6B096eLffUBU4IrwE0vHX5Nqt3AHs-QiSWMzkIQielPgfUYpNj2WMFWoeqLRbQYuCT-XsXsFCi9Afe-gcRuaQRw" alt><figcaption>Fügen Sie Ihrer Szene Quellen hinzu, indem Sie auf den + Button im Quellenbereich klicken und auswählen, welche Art von Quelle Sie hinzufügen möchten.</figcaption></figure>

Weitere Lektüre:

- Das [OBS Wiki](https://obsproject.com/wiki/Home)
- Unser Discord-Server: [https://discord.gg/youtubegaming](https://discord.gg/youtubegaming)
