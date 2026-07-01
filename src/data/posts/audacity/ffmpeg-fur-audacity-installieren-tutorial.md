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
image: "https://i.ytimg.com/vi/mY9wBvDgnfQ/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://www.youtube.com/watch?v=mY9wBvDgnfQ"
video:
  youtubeId: "mY9wBvDgnfQ"
  embedUrl: "https://www.youtube.com/embed/mY9wBvDgnfQ"
  watchUrl: "https://www.youtube.com/watch?v=mY9wBvDgnfQ"
  thumbnailUrl: "https://i.ytimg.com/vi/mY9wBvDgnfQ/maxresdefault.jpg"
---

## Transkript

FFmpeg ist eine Bibliothek, die notwendig ist, um verschiedene Arten von Mediendateien zu offnen, zu importieren und zu exportieren. Standardmassig ist sie nicht in Audacity enthalten. Um sie herunterzuladen, gehst du einfach auf diese Website. Dort werden dir drei Optionen angezeigt. Die erste ist 64-Bit-Windows, was fur die meisten Leute am nutzlichsten sein wird. macOS findest du ebenfalls hier, und 32-Bit ist auf modernen Systemen normalerweise nicht relevant.

Um FFmpeg zu installieren, klickst du einfach auf den Link und offnest die gerade heruntergeladene Datei, also den Installer. Klicke hier auf "Yes", akzeptiere die Vereinbarung, speichere es im Standardpfad, klicke auf "Install", und schon bist du fertig. Wenn du jetzt zuruck zu Audacity gehst und auf den "Locate"-Button klickst, wird dir angezeigt: "Success! Audacity has automatically detected valid FFmpeg files." Wir mussen die Dateien also nicht noch einmal manuell suchen, klicken auf "No", und hier sehen wir die Version, die wir gerade installiert haben. Klicke auf "OK", und das war es im Grunde schon.

Wenn du Audacity schon sehr lange nutzt und eine sehr alte 32-Bit-Version von Audacity hast, musst du in diesem Fall die 32-Bit-Version von FFmpeg verwenden oder Audacity aktualisieren. Um zu prufen, welche Audacity-Version du verwendest, gehe zu Help > About Audacity > Build Information. Wenn dort "64-bit" steht, hast du die 64-Bit-Version. Wenn dort nichts steht, hast du die 32-Bit-Version.

Wenn du Linux verwendest, wirst du sehen, dass diese Website keinen Linux-Download anbietet. Stattdessen bekommst du deine Linux-Version von FFmpeg direkt aus deinem Repository. Die Anleitung dazu steht auf der Website. Alternativ kannst du einfach deinen Paketmanager verwenden.

Wenn du den empfohlenen Installer nicht verwenden mochtest, zum Beispiel weil du eine modernere Version von FFmpeg nutzen willst, kannst du das uber die hier bereitgestellten Links tun oder deine eigene Version kompilieren. Wenn du das machst, solltest du wissen, dass die meisten Builds, zum Beispiel wenn wir diesen hier nehmen, unterschiedliche Versionen zwischen der normalen vollstandig eigenstandigen Version und der Shared-Version haben. Audacity funktioniert nur mit der Shared-Version.

Wenn wir diese Datei herunterladen, also irgendeine Art ZIP-Datei, und sie entpacken, liegt sie jetzt als Ordner in unserem Downloads-Ordner. Audacity weiss nichts von dieser FFmpeg-Installation, also mussen wir Audacity sagen, wo sie ist. Gehe dafur zu Preferences > Libraries und klicke auf "Locate". Wir bekommen dieselbe Frage wieder. Diesmal wollen wir die Datei manuell suchen, also klicken wir auf den "Browse"-Button. Navigiere jetzt zur entsprechenden Datei. Sie liegt normalerweise im bin-Ordner, und hier finden wir avformat-60.dll. Wenn du auf "OK" klickst, aktualisiert sich die Version in Audacity, und du kannst jetzt die andere FFmpeg-Version verwenden.

Zusatzlich findest du in der Beschreibung einen Link zu der Anleitung, der ich hier gefolgt bin. Wenn du Fragen hast, kannst du sie gern im Audacity-Forum oder auf Discord stellen. Das war alles, was ich heute fur dich habe. Tschuss und mach's gut!
