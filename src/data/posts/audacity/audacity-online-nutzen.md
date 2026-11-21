---
id: 990006
slug: "audacity-online-nutzen"
path: "/audacity/audacity-online-nutzen/"
title: "Audacity online nutzen: So geht’s mit Soundscaper"
excerpt: "Audacity hat keine offizielle Webversion. Mit Soundscaper auf Basis von Audacity 4 kannst du Audio kostenlos im Browser aufnehmen, bearbeiten und exportieren."
date: "2026-11-21T00:00:00"
modified: "2026-11-21T00:00:00"
locale: "de"
translationKey: "post:990005"
aiGenerated: true
category: "audacity"
tags: ["Audacity", "Soundscaper", "Audiobearbeitung", "Open Source"]
relatedPosts: ["/audacity/die-beste-kostenlose-audacity-alternative-2027/", "/audacity/audacity-4-fehlt-vieles-von-audacity-3-ich-habe-es-hinzugefugt/"]
authorName: "Leo Wattenberg"
sourceUrl: "https://soundscaper.org/docs/de/tutorials/your-first-project/"
sources:
  - title: "Offizielle Audacity-Downloads"
    url: "https://www.audacityteam.org/download/"
  - title: "Soundscaper-Quellcode"
    url: "https://github.com/mindscaper-org/Soundscaper"
  - title: "Dokumentation zum Wavacity-Quellcode"
    url: "https://github.com/ahilss/wavacity/blob/master/README.txt"
---

Audacity hat keine offizielle Online-Version. Das Audacity-Team bietet das Programm für Windows, macOS und Linux zum Download an. Wenn du ohne Installation wie in Audacity arbeiten möchtest, kannst du **Soundscaper** nutzen. Der kostenlose Open-Source-Editor basiert auf Audacity 4 und bringt Mehrspuraufnahme, Schnitt, Rauschminderung und Effekte in den Browser. [Soundscaper im Browser öffnen](https://soundscaper.org/de/).

## So bearbeitest du Audio im Browser

1. **Datei importieren oder aufnehmen.** Wähle **Datei → Importieren** und öffne eine Audiodatei. Für eine neue Aufnahme klickst du auf die rote Aufnahmetaste und erlaubst dem Browser den Zugriff auf dein Mikrofon.
2. **Clips bearbeiten.** Ziehe am Rand eines Clips, um ihn zu kürzen. Mit dem **Trennwerkzeug** kannst du direkt in die Wellenform klicken, um den Clip an dieser Stelle zu teilen. Markiere einen Abschnitt und öffne das Menü **Effekt**, um etwa Rauschen zu reduzieren oder den Ton auszublenden.
3. **Fertiges Audio exportieren.** Wähle **Datei → Audio exportieren** und dann das gewünschte Format. WAV eignet sich für eine verlustfreie Kopie, MP3 für eine kleinere Datei zum Teilen.
4. **Bearbeitbares Projekt sichern.** Lade über **Datei → Projektdatei (.sscape) exportieren** eine Projektdatei herunter. Soundscaper verarbeitet dein Audio auf deinem Gerät und speichert das laufende Projekt direkt im Browser. Ein Konto brauchst du dafür nicht. Mit der heruntergeladenen Datei kannst du weiterarbeiten, wenn du die Websitedaten löschst oder den Computer wechselst.

## Soundscaper und Wavacity im Vergleich

Wavacity ist eine Browser-Portierung auf Basis von Audacity 3.0.2. Soundscaper basiert auf dem neueren **Audacity 4** und übernimmt dessen überarbeitete Oberfläche und Clipbearbeitung. Wenn du Audacity 4 kennst, findest du dich in der Zeitleiste, beim Schneiden und beim Einsatz von Echtzeiteffekten schnell zurecht.

Schon im Browser bietet Soundscaper zusätzliche Funktionen. Du kannst eine Passage in einer Schleife mehrmals aufnehmen und aus den besten Teilen einen fertigen Take zusammensetzen. Über Busse und Sends im Mischpult lassen sich mehrere Spuren mit einem gemeinsamen Effekt bearbeiten. Per Automation kannst du Lautstärke, Panorama oder Effekteinstellungen im Zeitverlauf ändern. Native Plug-ins von Drittanbietern wie VST3 brauchen eine kompatible Desktop-Version. [Funktionsvergleich zwischen Soundscaper und Audacity](https://soundscaper.org/docs/de/start/how-soundscaper-compares/).

## Kann ich ein Audacity-Projekt in Soundscaper öffnen?

Ja. Über **Datei → Öffnen** kannst du eine `.aup3`- oder `.aup4`-Datei öffnen. Wenn du in Audacity 4 weiterarbeiten möchtest, wähle **Datei → Weitere Exporte → AUP4 exportieren**. Prüfe im Kompatibilitätsbericht, welche Effekte oder Mischpulteinstellungen sich beim Export ändern, und bewahre das vollständige Soundscaper-Projekt als `.sscape`-Datei auf. [Anleitung zu Soundscaper-Projektdateien](https://soundscaper.org/docs/de/projects-and-data/project-files/).

Soundscaper wurde von Leo Wattenberg entwickelt, dem Autor dieser Website.
