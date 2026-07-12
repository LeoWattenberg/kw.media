---
id: 3405
slug: "desktop-audio-in-audacity-aufnehmen-tutorial"
path: "/audacity/desktop-audio-in-audacity-aufnehmen-tutorial/"
title: "Desktop-Audio in Audacity aufnehmen [Tutorial]"
excerpt: "So nimmst du unter Windows Desktop-Audio in Audacity auf, stellst WASAPI-Loopback korrekt ein und vermeidest typische Aufnahmefehler."
date: "2023-09-02T21:41:18"
modified: "2023-09-02T21:41:18"
locale: "de"
translationKey: "video:VB0-XfW6lms"
category: "audacity"
tags: ["Audioaufnahme", "Desktop-Audio", "Audacity Tutorial", "Windows WASAPI", "Aufnahmegeräte", "Stereo-Aufnahme", "Overdub", "Audiokontrolle", "Fehlermeldungen"]
relatedPosts: ["/audacity/ffmpeg-fur-audacity-installieren-schnelltutorial/", "/audacity/ffmpeg-fur-audacity-installieren-tutorial/", "/audacity/ich-habe-an-audacity-4-gearbeitet-das-musst-du-wissen/"]
image: "https://i.ytimg.com/vi/VB0-XfW6lms/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://www.youtube.com/watch?v=VB0-XfW6lms"
video:
  youtubeId: "VB0-XfW6lms"
  embedUrl: "https://www.youtube.com/embed/VB0-XfW6lms"
  watchUrl: "https://www.youtube.com/watch?v=VB0-XfW6lms"
  thumbnailUrl: "https://i.ytimg.com/vi/VB0-XfW6lms/maxresdefault.jpg"
sources:
  - title: "support.audacityteam.org"
    url: "https://support.audacityteam.org/basics/recording-desktop-audio"
postCta:
  text: "Du möchtest mehr über Audioaufnahmen mit Audacity erfahren? Auf unserer {page} findest du weitere Tutorials und Tipps, um deine Audioqualität zu verbessern, oder kontaktiere unten unseren Experten."
  pagePath: "/de/audacity/"
  pageTitle: "Audacity Tutorials"
---

<!-- kwm:article:start -->
## Desktop-Audio in Audacity aufnehmen

Wenn du als Creator Audioinhalte direkt von deinem Computer aufnehmen möchtest – etwa Systemtöne, Web-Audio oder andere interne Quellen –, bietet Audacity unter Windows eine effiziente Lösung. Der Schlüssel hierzu ist die sogenannte Loopback-Funktion. In diesem Tutorial erfährst du, wie du die Einstellungen korrekt vornimmst und welche Fallstricke du vermeiden musst.

### Den richtigen Host auswählen

Der erste Schritt für die Aufnahme von Desktop-Audio ist die Wahl des richtigen Audio-Hosts. Standardmäßig ist Audacity oft auf andere Modi eingestellt, doch für die interne Aufnahme unter Windows ist eine spezifische Einstellung notwendig.

Gehe in der Menüleiste zu **Audio Setup > Host** und wähle dort **Windows WASAPI** aus. 

Es ist wichtig zu beachten, dass diese Anleitung spezifisch für Windows optimiert ist. Die Aufnahme von Desktop-Audio unter macOS oder Linux gestaltet sich deutlich komplizierter und wird in diesem Tutorial nicht behandelt.

### Das richtige Aufnahmegerät finden

Sobald du den Host auf Windows WASAPI umgestellt hast, verändert sich die Liste deiner verfügbaren Aufnahmegeräte. Du wirst feststellen, dass deine normalen Wiedergabegeräte (wie Lautsprecher oder Kopfhörer) nun auch im Bereich der Aufnahmegeräte auftauchen. Diese sind nun mit dem Zusatz **"(loopback)"** gekennzeichnet.

Im Grunde bedeutet das, dass deine Lautsprecher nun wie ein Mikrofon fungieren und das Signal, das normalerweise ausgegeben wird, zurück in Audacity leiten. Du solltest hier genau das Gerät auswählen, das du auch tatsächlich für deine Audioausgabe nutzt.

Falls du unsicher bist, welches Gerät gerade aktiv ist, gibt es einen einfachen Trick:
1. Klicke unten in deiner Windows-Taskleiste auf das Lautsprecher-Symbol.
2. Öffne über das weitere Lautsprecher-Symbol die Liste der aktiven Ausgabegeräte.
3. Das dort ausgewählte Gerät ist dein aktives Ausgabemedium. Genau dieses Gerät musst du nun in Audacity auswählen – allerdings eben in der Version mit dem Zusatz "loopback".

### Kanäle einstellen und die erste Aufnahme starten

Bevor du den Aufnahme-Button drückst, gibt es eine wichtige Einstellung bei den Aufnahmekanalen: Wähle hier **Stereo** aus. Da fast alle Desktop-Audioausgaben im Stereo-Format vorliegen, vermeidest du so Qualitätsverluste oder Fehler in der Signalverarbeitung.

Wenn du nun auf die Aufnahme-Taste drückst, wirst du bemerken, dass zunächst nichts passiert und keine Wellenform gezeichnet wird. Das ist völlig normal und beabsichtigt. Audacity befindet sich in einem Wartezustand und wartet auf ein Eingangssignal. Erst in dem Moment, in dem du auf deinem Computer Audio abspielst (z. B. ein Video startest oder Musik abspielst), beginnt Audacity mit der eigentlichen Aufnahme. Sobald du die Audioquelle stoppst, kannst du auch die Aufnahme in Audacity beenden.

### Kontinuierliche Aufnahmen und die Overdub-Funktion

In manchen Fällen möchtest du Audio nicht nur punktuell, sondern kontinuierlich aufnehmen oder mehrere Spuren kombinieren. Wenn du bereits eine Aufnahme gemacht hast, solltest du diese zunächst entfernen oder eine neue Spur hinzufügen.

Um einen reibungslosen Ablauf zu gewährleisten, prüfe unter **Transport > Transport Options**, ob die Option **"Overdub"** aktiviert ist. In der Regel ist dies standardmäßig der Fall. 

Ein kritischer Punkt für die Stabilität der Aufnahme ist die Übereinstimmung deiner Geräte: Dein Wiedergabegerät muss zwingend dasselbe sein wie dein Aufnahmegerät (das Loopback-Gerät). Wenn diese beiden Einstellungen nicht zusammenpassen, kann es zu kryptischen Fehlermeldungen kommen – ein bekanntes Beispiel hierfür ist der Fehlercode **-9997**. Wenn die Geräte jedoch identisch sind, funktioniert die kontinuierliche Aufnahme ohne Unterbrechungen.

### Fehlerbehebung: Die Abtastrate (Sample Rate)

Solltest du trotz korrekter Host- und Geräteeinstellungen auf Fehlermeldungen stoßen, liegt das Problem oft an einer Diskrepanz zwischen der Projektvorlage von Audacity und den Windows-Systemeinstellungen.

Hier ist die Lösung:
1. Gehe in die Audioeinstellungen von Audacity und prüfe die **Projektvorlage** (die Abtastrate).
2. Vergleiche diesen Wert mit deinen Windows-Audioeinstellungen. Diese findest du über das Lautsprecher-Symbol in der Taskleiste unter den erweiterten Lautstärkeeinstellungen für das jeweilige Gerät.
3. Stelle sicher, dass beide Werte übereinstimmen. Ein gängiger Standardwert ist beispielsweise **44,1 kHz**.

Ein wichtiger Hinweis zum Sample-Format: Dieses ist für die reine Aufnahme weniger relevant. Es wird empfohlen, in Audacity bei **32-Bit-Float** zu bleiben, da dies das Format ist, welches auch von den meisten Effekten innerhalb der Software verwendet wird und somit die beste Kompatibilität bietet.
<!-- kwm:article:end -->

<!-- kwm:transcript:start -->
## Transkript

Um Desktop-Audio in Audacity aufzunehmen, gehe zu Audio Setup > Host und stelle den Host auf Windows WASAPI. Bei Mac oder Linux ist das deutlich komplizierter, und darauf werde ich in diesem Tutorial nicht eingehen.

Sobald du das gemacht hast, findest du deine Wiedergabegerate jetzt auch im Bereich der Aufnahmegerate, allerdings mit "loopback" dahinter. Das sind deine Lautsprecher, die jetzt aber wie ein Mikrofon funktionieren. Du solltest das Gerat auswahlen, das deiner tatsachlichen Ausgabe entspricht. Wenn du dir nicht sicher bist, welches die richtige Auswahl ist, kannst du hier unten auf das Lautsprecher-Symbol und dann auf dieses andere Lautsprecher-Symbol gehen. Dort ist die passende Auswahl bereits ausgewahlt, und genau diese musst du dann auch in Audacity auswahlen, nur eben mit "loopback" dahinter.

Wahle ausserdem bei den Aufnahmekanalen Stereo aus, da all diese Ausgaben stereo sind. Wenn du jetzt auf Aufnahme druckst, wirst du sehen, dass nicht viel passiert. Das ist Absicht, denn Audacity wartet jetzt auf ein Eingangssignal. Wenn du nun Audio abspielst, beginnt Audacity damit, dieses Audio fur dich aufzunehmen. Wenn du das Audio stoppst, stoppst du damit auch die Aufnahme.

Wenn du stattdessen Audio kontinuierlich aufnehmen mochtest, musst du zuerst diese Aufnahme entfernen und dann zusatzlich zu der Spur, in die du aufnehmen willst, eine weitere Spur hinzufugen. Stelle sicher, dass unter Transport > Transport Options die Option "Overdub" aktiviert ist. Sie ist standardmassig aktiviert. Stelle ausserdem sicher, dass dein Wiedergabegerat dasselbe ist wie dein Aufnahmegerat. Wenn diese beiden nicht zusammenpassen, bekommst du stattdessen irgendeine kryptische Fehlermeldung wie -9997 oder ein anderes unerwunschtes Verhalten. Wenn diese beiden aber gleich sind, nimmt Audacity jetzt dein Desktop-Audio auf. Wenn ich die Datei jetzt wieder abspiele, siehst du, dass es einfach kontinuierlich funktioniert.

Wenn du an dieser Stelle auf andere Fehlermeldungen stosst, musst du stattdessen in deine Audioeinstellungen gehen. Dort findest du die Projektvorlage. Diese Abtastrate kannst du mit deinen Audiogeraten abgleichen, die du wiederum uber das Lautsprecher-Symbol > weitere Lautstarkeeinstellungen findest. Hier findest du fur den betreffenden Lautsprecher den passenden Wert. In meinem Fall sind es 44,1 kHz, was meiner Projektrate entspricht. Das Sample-Format ist ubrigens nicht wichtig, und du solltest es in Audacity normalerweise bei 32-Bit-Float lassen, weil das auch das Format ist, das alle Effekte verwenden.

Das war alles, was ich fur dich in diesem Tutorial habe. Wenn du Fragen hast, kannst du sie im Discord oder im Forum stellen. Eine aktualisierte Version dieser Anleitung findest du uber den Link in der Beschreibung. Und damit: Mach's gut und tschuss!
<!-- kwm:transcript:end -->
