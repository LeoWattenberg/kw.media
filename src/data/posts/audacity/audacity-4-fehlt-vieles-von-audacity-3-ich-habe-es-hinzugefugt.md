---
id: 3426
slug: "audacity-4-fehlt-vieles-von-audacity-3-ich-habe-es-hinzugefugt"
path: "/audacity/audacity-4-fehlt-vieles-von-audacity-3-ich-habe-es-hinzugefugt/"
title: "Audacity 4 fehlt vieles von Audacity 3 – ich habe es hinzugefügt"
excerpt: "Welche Audacity-3-Funktionen fehlen noch in Audacity 4.0.2? Audacity 3.7.9, Audacity 4.0.2 und Soundscaper im Vergleich, mit den Audacity-Spalten anhand der Quellcode-Tags überprüft."
date: "2026-09-04T10:00:00"
modified: "2026-11-15T10:00:00"
locale: "de"
translationKey: "post:3425"
category: "audacity"
tags: ["Audacity 4", "Audacity 3", "Soundscaper", "Audio Editing", "Feature Comparison", "Software Update", "Effects", "Macros", "Audio Export", "Open Source"]
relatedPosts: ["/en/audacity/i-worked-on-audacity-4-here-is-what-you-need-to-know/", "/en/audacity/recording-desktop-audio-in-audacity-tutorial/", "/en/audacity/installing-ffmpeg-for-audacity-tutorial/"]
image: "https://i.ytimg.com/vi/5nJuWdclGkw/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://kw.media/en/audacity/audacity-4-is-missing-lots-of-audacity-3-features-i-added-them/"
sources:
  - title: "Audacity 4.0.2 source tag"
    url: "https://github.com/audacity/audacity/tree/Audacity-4.0.2"
  - title: "Audacity 3.7.9 source tag"
    url: "https://github.com/audacity/audacity/tree/Audacity-3.7.9"
  - title: "Audacity 4.0.2 changelog and compatibility notes"
    url: "https://github.com/audacity/audacity/blob/Audacity-4.0.2/CHANGELOG.txt"
  - title: "Audacity 4.0.2 built-in effect registration"
    url: "https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/effects/builtin_collection/internal/builtincollectionloader.cpp"
  - title: "Audacity 4.0.2 editing commands"
    url: "https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/trackedit/internal/trackeditactionscontroller.cpp"
  - title: "Audacity 4.0.2 playhead and selection commands"
    url: "https://github.com/audacity/audacity/blob/Audacity-4.0.2/src/projectscene/view/playcursor/playpositionactioncontroller.cpp"
  - title: "Soundscaper, in your browser"
    url: "https://kw.media/en/tools/audio-editor/"
---

Moin. [Ich habe an Audacity 4](/de/audacity/ich-habe-an-audacity-4-gearbeitet-hier-ist-was-du-wissen-musst/) gearbeitet, das inzwischen bei Version 4.0.2 angekommen ist. Wenn du von Audacity 3 kommst, wirst du sehen, dass es jetzt viel besser aussieht und einige wirklich nützliche neue UX-Funktionen hat, mehr dazu im [Release-Video](https://www.youtube.com/watch?v=BTQymidLYIM). Allerdings wirst du auch bald merken, dass es etwas... unfertig ist. Zum Start fehlten mehrere Effekte und andere Funktionen, darunter einige lebenswichtige wie das Exportieren von Stems und Mix & Render. Der Stem-Export ist inzwischen zurück, während Mix & Render auch in 4.0.2 noch fehlt. Warum die Entscheidung getroffen wurde, es so zu veröffentlichen, weiß ich nicht, da ich das Team Ende 2025 verlassen habe. Aber wenn ich raten müsste (und das ist wirklich nur eine Vermutung), dann liegt es wahrscheinlich am Zeitdruck von den Unternehmensbossen, die wahrscheinlich unabhängig vom Inhalt eine Veröffentlichung bis zu einem bestimmten Datum gefordert haben! Also ist die ursprüngliche Veröffentlichung, obwohl sie 4.0 heißt, vielleicht eher mit einer Beta 5 vergleichbar, während die eigentliche vollständige 4.0 die Bezeichnung 4.1 tragen wird.

Auf jeden Fall: Im Vorfeld der Veröffentlichung habe ich viel mit LLMs experimentiert und einige [Creator-Tools](/de/tools) entwickelt. Irgendwann stellte ich mir die Frage: Kann ich eine Web-Version davon machen? Und ich konnte. Hier ist [Soundscaper](https://soundscaper.org), ein webbasierter Audio-Editor, der praktisch alle Funktionen von Audacity 4 integriert. Und während ich dabei war, habe ich auch eine Menge Audacity 3-Funktionen hinzugefügt. Also schau dir die folgende Tabelle mit den vielen Funktionen an, die du in Soundscaper nutzen kannst.

Du bist nicht auf Soundscaper beschränkt, Soundscaper kann AUP4-Dateien importieren und exportieren, sodass du zwischen den beiden wechseln kannst. Das ist besonders praktisch auf mobilen Geräten, denn Soundscaper, als Web-App, läuft überall, wo ein Browser läuft. Während du Audacity 4 also nicht auf deinem Handy verwenden kannst, kannst du in Soundscaper mit der Aufnahme und Bearbeitung beginnen und dann das AUP4 exportieren, um die Bearbeitung später auf deinem Desktop fortzusetzen. Oder du öffnest es einfach wieder in Soundscaper!

Soundscaper ist kostenlos und Open Source, und völlig privat – trotz Web-App gibt es kein Konto und alle Dateien bleiben auf deinem Gerät.

## Audacity 3.7.9 vs. Audacity 4.0.2 vs. Soundscaper

*Aktualisiert am 15. November 2026. Die Audacity-Spalten vergleichen die Quellcode-Tags 3.7.9 und 4.0.2. Diese Liste konzentriert sich auf Funktionen, die vom Wechsel zu Audacity 4 betroffen sind, und enthält zur Einordnung auch einige beibehaltene oder zurückgekehrte Funktionen. Sie ist keine vollständige Funktionsliste.*

Audacity 4.0.1 brachte den Export einzelner Spuren oder beschrifteter Bereiche als separate Dateien zurück. In 4.0.2 wurden der Trim-Tastaturbefehl sowie mehrere Auswahl- und Zoom-Tastaturbefehle wiederhergestellt. Diese Änderungen sind unten berücksichtigt. [Audacitys Änderungsprotokoll](https://github.com/audacity/audacity/blob/Audacity-4.0.2/CHANGELOG.txt) nennt für 4.0.2 außerdem Korrekturen für Abstürze und beschädigte Projekte.

| Funktion | Audacity 3.7.9 | Audacity 4.0.2 | Soundscaper |
| --- | --- | --- | --- |
| **In Audacitys eigenen Kompatibilitätsnotizen genannt** | | | |
| Zeitspuren | Ja | Nein | Nein – stattdessen Automatisierungsspuren und Tempokarten |
| Notenspuren | Ja | Nein | Ja - beta |
| Mischpult | Ja | Nein | Ja |
| Makros | Ja | Nein | Ja – inklusive JS-Skripting |
| Skripting-Pipe und die Skriptables-Befehle | Ja | Nein | Nein |
| VAMP und LADSPA-Plug-in-Hosting | Ja | Nein | Ja - nur Desktopversion |
| Play-at-Speed | Ja | Nein | Ja |
| **Effekte** | | | |
| Auto Duck | Ja | Nein | Ja |
| Effekt zur Geschwindigkeitsänderung | Ja | Kein separater Effekt – Tonhöhe und Geschwindigkeit lassen sich am Clip einstellen | Ja |
| Effekt zur Tempoveränderung | Ja | Kein separater Effekt – Projekttempo und Clip-Stretching sind verfügbar | Ja |
| Klassische Filter | Ja | Nein | Ja |
| Verzerrung | Ja | Nein | Ja |
| Echo | Ja | Nein | Ja |
| Phaser | Ja | Nein | Ja |
| Wahwah | Ja | Nein | Ja |
| Wiederholen | Ja | Nein | Ja |
| Legacy-Kompressor | Ja | Nein | Ja |
| Echtzeit-Effekt-Rack pro Spur | Ja | Ja | Ja – und mehr hinzugefügt |
| **Analyzer** | | | |
| Spektrum anzeigen | Ja | Nein | Ja |
| Kontrast | Ja | Nein | Ja |
| Clipping finden | Ja | Nein | Ja |
| **Aufnahme** | | | |
| Timer-Aufnahme | Ja | Nein | Ja |
| Sound-aktivierte Aufnahme | Ja | Nein | Ja |
| Punch and Roll | Ja | Ja – umbenannt in Lead-in-Aufnahme | Ja |
| **Export und Import** | | | |
| Nur die Auswahl exportieren | Ja | Ja | Ja |
| Jedes Label als separate Datei exportieren | Ja | Ja – seit 4.0.1 wieder verfügbar | Ja |
| Spuren als separate Stems exportieren | Ja | Ja – seit 4.0.1 wieder verfügbar | Ja |
| Rohdaten importieren | Ja | Nein | Ja |
| **Spuren** | | | |
| Mix und Render | Ja | Nein | Ja |
| Spuren ausrichten (sieben Befehle) | Ja | Nein | Ja |
| Spuren nach Name oder Startzeit sortieren | Ja | Nein | Ja |
| Alle Spuren stummschalten und wieder aktivieren | Ja | Nein | Ja |
| Pan und Gain-Befehle für die fokussierte Spur | Ja | Nein | Ja |
| **Bearbeitung und Auswahl** | | | |
| Beschriftete Audio-Befehle (schneiden, löschen, aufteilen, zusammenführen nach Beschriftungsbereich) | Ja | Nein | Nein |
| Auswahl speichern und abrufen, Cursor-Position speichern | Ja | Nein | Nein |
| Audio außerhalb der Auswahl kürzen | Ja | Ja – Strg+T in 4.0.2 wiederhergestellt | Ja |
| Abspielposition zum Anfang oder Ende der Auswahl bewegen | Ja | Ja – Tastaturbefehle in den Einstellungen zuweisen | Ja |
| Zu vorheriger oder nächster Beschriftung springen | Ja | Nein | Nein |
| Tastatur-Scrubbing und die Suchen-während-Wiedergabe-Befehle | Ja | Nein | Nein |
| Vorschau-Wiedergabe (eine Sekunde abspielen, bis zur Auswahl abspielen, Vorschau schneiden) | Ja | Nein | Nein |
| Spektrale Auswahl, spektrale Löschung und spektrale Verstärkung | Ja | Ja | Ja – auch spektrales Zeichnen hinzugefügt |
| **Ansicht und Fenster** | | | |
| An Höhe anpassen | Ja | Nein | Ja |
| Alle Spuren zusammenfalten und erweitern | Ja | Nein | Ja |
| Ansicht zum Anfang oder Ende der Auswahl scrollen (Springen zu) | Ja | Nein | Ja |
| Das Extra-Menü (Cursor-Sprünge, Befehle für fokussierte Spur) | Ja | Nein | Teilweise |

## Aber warte... es gibt noch mehr!

Mein Fokus lag nicht nur darin, Audacity 4 zu kopieren. Ich habe auch viele neue Funktionen hinzugefügt, wie z.B.:

* Videospuren
* Spur-Routing (einschließlich Send-/Gruppen-Bussen)
* Projekt-Bin
* Automatisierung
* Surround-Unterstützung
* Erweitertes Format-Unterstützung

und noch vieles mehr, worüber du mehr in [den Soundscaper-Dokumentationen](https://soundscaper.org/docs/start/how-soundscaper-compares/) lesen kannst. Ich habe sogar angefangen, einen kompletten Video-Editor zu entwickeln, den ich [Framescaper](https://framescaper.org) nenne (obwohl ich dem noch nicht so viel Aufmerksamkeit geschenkt habe. Bisher.)

Ich hoffe, du hast Spaß mit Audacity 4 und Soundscaper!
