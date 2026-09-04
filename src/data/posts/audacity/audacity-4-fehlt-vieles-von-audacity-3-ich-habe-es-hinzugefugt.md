---
id: 3426
slug: "audacity-4-fehlt-vieles-von-audacity-3-ich-habe-es-hinzugefugt"
path: "/audacity/audacity-4-fehlt-vieles-von-audacity-3-ich-habe-es-hinzugefugt/"
title: "Audacity 4 fehlt vieles von Audacity 3 – ich habe es hinzugefügt"
excerpt: "Audacity 4 ist ein kompletter Neubau von Grund auf, und beim Neubau bleiben einige Dinge auf der Strecke. Hier ist eine vollständige Aufstellung dessen, was Audacity 3 konnte und Audacity 4 nicht mehr kann, basierend auf dem Quellcode beider Versionen."
date: "2026-09-04T10:00:00"
modified: "2026-09-04T10:00:00"
locale: "de"
translationKey: "post:3425"
category: "audacity"
tags: ["Audacity 4", "Audacity 3", "Soundscaper", "Audio Editing", "Feature Comparison", "Software Update", "Effects", "Macros", "Audio Export", "Open Source"]
relatedPosts: ["/en/audacity/i-worked-on-audacity-4-here-is-what-you-need-to-know/", "/en/audacity/recording-desktop-audio-in-audacity-tutorial/", "/en/audacity/installing-ffmpeg-for-audacity-tutorial/"]
image: "https://i.ytimg.com/vi/5nJuWdclGkw/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://kw.media/en/audacity/audacity-4-is-missing-lots-of-audacity-3-features-i-added-them/"
sources:
  - title: "Audacity 4.0.0 source tag"
    url: "https://github.com/audacity/audacity/tree/4c177d436e48c1d20f231eada44035593cb26292"
  - title: "Audacity 3.7.9 source tag"
    url: "https://github.com/audacity/audacity/tree/Audacity-3.7.9"
  - title: "Audacity 4.0 release notes (CHANGELOG.txt)"
    url: "https://github.com/audacity/audacity/blob/4c177d436e48c1d20f231eada44035593cb26292/CHANGELOG.txt"
  - title: "Soundscaper, in your browser"
    url: "https://kw.media/en/tools/audio-editor/"
---

Moin. [Ich habe an Audacity 4](/de/audacity/ich-habe-an-audacity-4-gearbeitet-hier-ist-was-du-wissen-musst/) gearbeitet, das gerade veröffentlicht wurde. Wenn du von Audacity 3 kommst, wirst du sehen, dass es jetzt viel besser aussieht und einige wirklich nützliche neue UX-Funktionen hat, mehr dazu im [Release-Video](https://www.youtube.com/watch?v=BTQymidLYIM). Allerdings wirst du auch bald merken, dass es etwas... unfertig ist. Mehrere Effekte und andere Funktionen fehlen, darunter einige lebenswichtige wie das Exportieren von Stems und Mix & Render. Warum die Entscheidung getroffen wurde, es so zu veröffentlichen, weiß ich nicht, da ich das Team Ende 2025 verlassen habe. Aber wenn ich raten müsste (und das ist wirklich nur eine Vermutung), dann liegt es wahrscheinlich am Zeitdruck von den Unternehmensbossen, die wahrscheinlich unabhängig vom Inhalt eine Veröffentlichung bis zu einem bestimmten Datum gefordert haben! Also ist diese Version, obwohl sie 4.0 heißt, vielleicht eher mit einer Beta 5 vergleichbar, während die eigentliche vollständige 4.0 die Bezeichnung 4.1 tragen wird.

Auf jeden Fall: Im Vorfeld der Veröffentlichung habe ich viel mit LLMs experimentiert und einige [Creator-Tools](/de/tools) entwickelt. Irgendwann stellte ich mir die Frage: Kann ich eine Web-Version davon machen? Und ich konnte. Hier ist [Soundscaper](https://soundscaper.org), ein webbasierter Audio-Editor, der praktisch alle Funktionen von Audacity 4 integriert. Und während ich dabei war, habe ich auch eine Menge Audacity 3-Funktionen hinzugefügt. Also schau dir die folgende Tabelle mit den vielen Funktionen an, die du in Soundscaper nutzen kannst.

Du bist nicht auf Soundscaper beschränkt, Soundscaper kann AUP4-Dateien importieren und exportieren, sodass du zwischen den beiden wechseln kannst. Das ist besonders praktisch auf mobilen Geräten, denn Soundscaper, als Web-App, läuft überall, wo ein Browser läuft. Während du Audacity 4 also nicht auf deinem Handy verwenden kannst, kannst du in Soundscaper mit der Aufnahme und Bearbeitung beginnen und dann das AUP4 exportieren, um die Bearbeitung später auf deinem Desktop fortzusetzen. Oder du öffnest es einfach wieder in Soundscaper!

Soundscaper ist kostenlos und Open Source, und völlig privat – trotz Web-App gibt es kein Konto und alle Dateien bleiben auf deinem Gerät.

## Audacity 3 vs. Audacity 4 vs. Soundscaper

*(Hinweis: Dies ist eine "negative" Liste, die nur die Funktionen auflistet, die in Audacity 4 fehlen. Es soll nicht bedeuten, dass Audacity nur Funktionen fehlen, da es immer noch viele hat)*

| Funktion | Audacity 3.7.9 | Audacity 4.0.0 | Soundscaper |
| --- | --- | --- | --- |
| **In Audacitys eigenen Kompatibilitätsnotizen genannt** | | | |
| Zeitspuren | Ja | Nein | Nein – stattdessen Automatisierungsspuren und Tempokarten |
| Notenspuren | Ja | Nein – Geplant für Audacity 5 | Nein – folgt Audacity |
| Mischpult | Ja | Nein | Ja |
| Makros | Ja | Nein | Ja – inklusive JS-Skripting |
| Skripting-Pipe und die Skriptables-Befehle | Ja | Nein | Nein |
| VAMP und LADSPA-Plug-in-Hosting | Ja | Nein | Nein – noch keine Desktop-Version |
| Play-at-Speed | Ja | Nein | Ja |
| **Effekte** | | | |
| Auto Duck | Ja | Nein | Ja |
| Geschwindigkeitsänderung | Ja | Nein | Ja |
| Tempoveränderung | Ja | Nein | Ja |
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
| Jedes Label als separate Datei exportieren | Ja | Nein | Ja |
| Spuren als separate Stems exportieren | Ja | Nein | Ja |
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
| Audio außerhalb der Auswahl kürzen | Ja | Nein | Ja |
| Zu vorheriger oder nächster Beschriftung springen | Ja | Nein | Nein |
| Tastatur-Scrubbing und die Suchen-während-Wiedergabe-Befehle | Ja | Nein | Nein |
| Vorschau-Wiedergabe (eine Sekunde abspielen, bis zur Auswahl abspielen, Vorschau schneiden) | Ja | Nein | Nein |
| Spektrale Auswahl, spektrale Löschung und spektrale Verstärkung | Ja | Ja | Ja – auch spektrales Zeichnen hinzugefügt |
| **Ansicht und Fenster** | | | |
| An Höhe anpassen | Ja | Nein | Ja |
| Alle Spuren zusammenfalten und erweitern | Ja | Nein | Ja |
| Zu Start oder Ende der Auswahl springen | Ja | Nein | Ja |
| Das Extra-Menü (Cursor-Sprünge, Befehle für fokussierte Spur) | Ja | Teilweise |

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
