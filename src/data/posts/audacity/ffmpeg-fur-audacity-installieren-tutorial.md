---
id: 3404
slug: "ffmpeg-fur-audacity-installieren-tutorial"
path: "/audacity/ffmpeg-fur-audacity-installieren-tutorial/"
title: "FFmpeg für Audacity installieren [Tutorial]"
excerpt: "So installierst du FFmpeg für Audacity, nutzt den empfohlenen Installer oder bindest eine eigene geteilte FFmpeg-Version manuell ein."
date: "2023-08-30T14:53:36"
modified: "2023-08-30T14:53:36"
locale: "de"
translationKey: "video:mY9wBvDgnfQ"
category: "audacity"
tags: ["FFmpeg Installation", "Audacity Tutorial", "Audio-Tools", "Mediendateien", "Import/Export", "Windows-Installation", "Linux-Anleitung", "Manuelle Konfiguration"]
relatedPosts: ["/audacity/ffmpeg-fur-audacity-installieren-schnelltutorial/", "/audacity/desktop-audio-in-audacity-aufnehmen-tutorial/", "/audacity/ich-habe-an-audacity-4-gearbeitet-das-musst-du-wissen/"]
image: "https://i.ytimg.com/vi/mY9wBvDgnfQ/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://www.youtube.com/watch?v=mY9wBvDgnfQ"
video:
  youtubeId: "mY9wBvDgnfQ"
  embedUrl: "https://www.youtube.com/embed/mY9wBvDgnfQ"
  watchUrl: "https://www.youtube.com/watch?v=mY9wBvDgnfQ"
  thumbnailUrl: "https://i.ytimg.com/vi/mY9wBvDgnfQ/maxresdefault.jpg"
sources:
  - title: "lame.buanzo.org"
    url: "https://lame.buanzo.org/ffmpeg.php"
  - title: "Official guide"
    url: "https://support.audacityteam.org/basics/installing-ffmpeg"
  - title: "Users on versions pre-Audacity 3.2: Use ffmpeg-win-2.2.2 from"
    url: "https://lame.buanzo.org/#lamewindl"
  - title: "Audacity 3.3.3"
    url: "https://www.audacityteam.org/"
  - title: "7zip"
    url: "https://www.7-zip.org/"
  - title: "Mozilla Firefox"
    url: "https://www.mozilla.org/firefox/"
postCta:
  text: "Unsicher bei FFmpeg für Audacity installieren? Wir helfen dir weiter: Mehr Infos findest du auf {page}, oder kontaktiere unten unseren Experten."
  pagePath: "/de/audacity/"
  pageTitle: "Audacity Tutorials"
---

<!-- kwm:article:start -->
## Warum du FFmpeg für Audacity benötigst

Wenn du mit Audacity arbeitest, wirst du feststellen, dass das Programm zwar mächtig ist, aber standardmäßig nicht alle gängigen [Audio-](/de/tools/converter/video-audio-converter/) und Videoformate importieren oder exportieren kann. Hier kommt [FFmpeg](/de/tools/) ins Spiel. 

FFmpeg ist eine umfangreiche Bibliothek, die es Audacity ermöglicht, eine Vielzahl verschiedener Mediendateien zu öffnen und zu verarbeiten. Da diese Bibliothek nicht direkt in der Standardinstallation von Audacity enthalten ist, musst du sie separat installieren, um den vollen Funktionsumfang des Programms zu nutzen. Ohne FFmpeg fehlen dir wichtige Optionen beim Import von Dateien aus anderen Quellen oder beim Export in spezifische Formate.

## Die einfache Installation über den empfohlenen Installer

Für die meisten Nutzer ist der Weg über den offiziellen Installer am unkompliziertesten. Du findest die notwendigen Dateien auf der entsprechenden Download-Seite ([FFmpeg ist eine Bibliothek](/audacity/ffmpeg-fur-audacity-installieren-schnelltutorial/)). Dort werden dir in der Regel drei Optionen angeboten:

*   **64-Bit Windows:** Dies ist die Version, die für die überwiegende Mehrheit der modernen Windows-Systeme relevant ist.
*   **macOS:** Die entsprechende Version für Apple-Nutzer.
*   **32-Bit:** Diese Version ist heutzutage nur noch in Ausnahmefällen oder auf sehr alten Systemen von Bedeutung.

### Schritt-für-Schritt-Anleitung für Windows und macOS

1.  Klicke auf den Link der für dein System passenden Version (meist 64-Bit Windows).
2.  Öffne die heruntergeladene Installationsdatei.
3.  Bestätige die Sicherheitsabfrage mit "Yes".
4.  Akzeptiere die Lizenzvereinbarung und folge den Anweisungen des Installers.
5.  Speichere die Bibliothek im Standardpfad, den der Installer vorschlägt, und klicke auf "Install".

Sobald die Installation abgeschlossen ist, musst du Audacity mitteilen, dass die Dateien nun vorhanden sind. Gehe in Audacity auf den "Locate"-Button (Suchen). In den meisten Fällen erkennt das Programm die neuen Dateien automatisch. Du erhältst dann die Meldung: *"Success! Audacity has automatically detected valid FFmpeg files."* Bestätige dies mit "No" (falls du nicht manuell suchen möchtest) und klicke auf "OK", nachdem du die installierte Version überprüft hast.

## Die richtige Version wählen: 32-Bit vs. 64-Bit

Ein häufiger Fehler tritt auf, wenn eine Inkompatibilität zwischen der Audacity-Version und der FFmpeg-Bibliothek besteht. Wenn du eine sehr alte Version von Audacity nutzt, verwendest du möglicherweise noch die 32-Bit-Variante. In diesem Fall funktioniert ein 64-Bit-FFmpeg nicht; du müsstest entweder die 32-Bit-Version von FFmpeg installieren oder – was dringend empfohlen wird – Audacity auf eine aktuelle Version (wie z. B. 3.3.3) zu aktualisieren.

**So prüfst du deine Audacity-Version:**
Gehe im Menü auf `Help` > `About Audacity` > `Build Information`. Wenn dort explizit "64-bit" steht, bist du auf der sicheren Seite. Findest du diesen Hinweis nicht, nutzt du wahrscheinlich die 32-Bit-Version.

## FFmpeg unter Linux installieren

Linux-Nutzer werden feststellen, dass auf der Download-Seite kein direkter Installer angeboten wird. Das liegt daran, dass FFmpeg unter Linux üblicherweise über die offiziellen Paketquellen der jeweiligen Distribution verwaltet wird.

Du hast hier zwei Möglichkeiten:
1.  Folge der spezifischen Anleitung auf der Website für dein Betriebssystem.
2.  Nutze einfach deinen gewohnten Paketmanager (z. B. `apt`, `pacman` oder `dnf`), um FFmpeg direkt aus deinem Repository zu installieren.

## Manuelle Installation für Fortgeschrittene

Es gibt Situationen, in denen du den empfohlenen Installer nicht nutzen möchtest – etwa wenn du eine aktuellere Version von FFmpeg verwenden willst oder eine eigene Version kompilierst. In diesem Fall ist Vorsicht geboten, da es unterschiedliche Build-Typen gibt.

### Der wichtige Unterschied: Shared vs. Standalone
Wenn du FFmpeg manuell herunterlädst (beispielsweise als ZIP-Datei), wirst du oft die Wahl zwischen einer "vollständig eigenständigen" (Standalone) Version und einer "Shared"-Version haben. **Wichtig:** Audacity funktioniert ausschließlich mit der **Shared-Version**. Eine Standalone-Version wird vom Programm nicht erkannt.

### So bindest du eine manuelle Version ein:

1.  Lade die Shared-Version von FFmpeg herunter und entpacke sie (z. B. mit einem Tool wie 7zip) in einen Ordner deiner Wahl.
2.  Da Audacity nicht automatisch weiß, wo sich diese Dateien befinden, musst du den Pfad manuell zuweisen.
3.  Navigiere in Audacity zu `Preferences` > `Libraries`.
4.  Klicke auf "Locate". Wenn die Abfrage erscheint, ob du manuell suchen möchtest, klicke auf den "Browse"-Button.
5.  Suche nun im entpackten FFmpeg-Ordner nach dem Unterordner `bin`.
6.  Wähle dort die Datei `avformat-60.dll` aus und bestätige mit "OK".

Nach diesem Vorgang aktualisiert Audacity die Versionsanzeige in den Einstellungen, und du kannst fortan mit der manuell gewählten FFmpeg-Version arbeiten.

## Hilfe und Support

Solltest du während der Installation auf Probleme stoßen oder Fragen zur Konfiguration haben, gibt es verschiedene Anlaufstellen. Neben der offiziellen Anleitung des Audacity-Teams bieten das offizielle Audacity-Forum sowie die Discord-Community wertvolle Unterstützung durch andere Nutzer und Experten.
<!-- kwm:article:end -->

<!-- kwm:transcript:start -->
## Transkript

[FFmpeg ist eine Bibliothek](/audacity/ffmpeg-fur-audacity-installieren-schnelltutorial/), die notwendig ist, um verschiedene Arten von Mediendateien zu offnen, zu importieren und zu exportieren. Standardmassig ist sie nicht in Audacity enthalten. Um sie herunterzuladen, gehst du einfach auf diese Website. Dort werden dir drei Optionen angezeigt. Die erste ist 64-Bit-Windows, was fur die meisten Leute am nutzlichsten sein wird. macOS findest du ebenfalls hier, und 32-Bit ist auf modernen Systemen normalerweise nicht relevant.

Um FFmpeg zu installieren, klickst du einfach auf den Link und offnest die gerade heruntergeladene Datei, also den Installer. Klicke hier auf "Yes", akzeptiere die Vereinbarung, speichere es im Standardpfad, klicke auf "Install", und schon bist du fertig. Wenn du jetzt zuruck zu Audacity gehst und auf den "Locate"-Button klickst, wird dir angezeigt: "Success! Audacity has automatically detected valid FFmpeg files." Wir mussen die Dateien also nicht noch einmal manuell suchen, klicken auf "No", und hier sehen wir die Version, die wir gerade installiert haben. Klicke auf "OK", und das war es im Grunde schon.

Wenn du Audacity schon sehr lange nutzt und eine sehr alte 32-Bit-Version von Audacity hast, musst du in diesem Fall die 32-Bit-Version von FFmpeg verwenden oder Audacity aktualisieren. Um zu prufen, welche Audacity-Version du verwendest, gehe zu Help > About Audacity > Build Information. Wenn dort "64-bit" steht, hast du die 64-Bit-Version. Wenn dort nichts steht, hast du die 32-Bit-Version.

Wenn du Linux verwendest, wirst du sehen, dass diese Website keinen Linux-Download anbietet. Stattdessen bekommst du deine Linux-Version von FFmpeg direkt aus deinem Repository. Die Anleitung dazu steht auf der Website. Alternativ kannst du einfach deinen Paketmanager verwenden.

Wenn du den empfohlenen Installer nicht verwenden mochtest, zum Beispiel weil du eine modernere Version von FFmpeg nutzen willst, kannst du das uber die hier bereitgestellten Links tun oder deine eigene Version kompilieren. Wenn du das machst, solltest du wissen, dass die meisten Builds, zum Beispiel wenn wir diesen hier nehmen, unterschiedliche Versionen zwischen der normalen vollstandig eigenstandigen Version und der Shared-Version haben. Audacity funktioniert nur mit der Shared-Version.

Wenn wir diese Datei herunterladen, also irgendeine Art ZIP-Datei, und sie entpacken, liegt sie jetzt als Ordner in unserem Downloads-Ordner. Audacity weiss nichts von dieser FFmpeg-Installation, also mussen wir Audacity sagen, wo sie ist. Gehe dafur zu Preferences > Libraries und klicke auf "Locate". Wir bekommen dieselbe Frage wieder. Diesmal wollen wir die Datei manuell suchen, also klicken wir auf den "Browse"-Button. Navigiere jetzt zur entsprechenden Datei. Sie liegt normalerweise im bin-Ordner, und hier finden wir avformat-60.dll. Wenn du auf "OK" klickst, aktualisiert sich die Version in Audacity, und du kannst jetzt die andere FFmpeg-Version verwenden.

Zusatzlich findest du in der Beschreibung einen Link zu der Anleitung, der ich hier gefolgt bin. Wenn du Fragen hast, kannst du sie gern im Audacity-Forum oder auf Discord stellen. Das war alles, was ich heute fur dich habe. Tschuss und mach's gut!
<!-- kwm:transcript:end -->
