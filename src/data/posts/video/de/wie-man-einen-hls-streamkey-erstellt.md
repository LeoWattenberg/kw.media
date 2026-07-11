---
id: 3089
slug: "wie-man-einen-hls-streamkey-erstellt"
path: "/youtube-tipps-de/wie-man-einen-hls-streamkey-erstellt/"
title: "Wie man einen HLS-Stream-Schlüssel erstellt"
excerpt: "Um HDR in deinen YouTube-Streams korrekt anzuzeigen, musst du das HLS-Protokoll nutzen. Erfahre, wie du einen Stream-Tier erstellst, der HLS unterstützt."
date: "2022-09-13T18:42:14"
modified: "2022-09-13T18:42:14"
locale: "de"
translationKey: "video:RSeROQWVAPk"
category: "short-tutorial"
tags: ["HDR-Streaming", "YouTube-Streaming", "Stream-Schlüssel", "HLS-Protokoll", "Live Control Room", "Stream-Einstellungen"]
image: "https://i.ytimg.com/vi/RSeROQWVAPk/maxresdefault.jpg"
authorName: "Martin Koytek"
sourceUrl: "https://www.youtube.com/shorts/RSeROQWVAPk"
video:
  youtubeId: "RSeROQWVAPk"
  embedUrl: "https://www.youtube.com/embed/RSeROQWVAPk"
  watchUrl: "https://www.youtube.com/shorts/RSeROQWVAPk"
  thumbnailUrl: "https://i.ytimg.com/vi/RSeROQWVAPk/maxresdefault.jpg"
postCta:
  text: "Um HDR in deinen YouTube-Streams korrekt anzuzeigen, musst du das HLS-Protokoll nutzen. Erfahre mehr darüber, wie du einen Stream-Tier erstellst, der HLS unterstützt, auf unserer {page}, oder kontaktiere unten unseren Experten."
  pagePath: "/de/creator/"
  pageTitle: "Creator Support und Beratung"
---

<!-- kwm:article:start -->
## HDR-Streaming auf YouTube: Warum HLS wichtig ist

Wenn du als Creator die visuelle Qualität deiner [Live-Übertragungen](/de/live/) steigern und HDR (High Dynamic Range) korrekt auf YouTube anzeigen möchtest, reicht ein Standard-Setup oft nicht aus. Damit die erweiterten Farbinformationen und Kontraste von HDR präzise an deine Zuschauer übertragen werden, muss der Stream über das HLS-Protokoll (HTTP Live Streaming) gesendet werden.

Damit YouTube diesen Datenstrom korrekt verarbeiten und ausliefern kann, ist eine spezifische Konfiguration in deinem Backend notwendig. Du musst einen sogenannten Stream-Tier erstellen, der explizit die Unterstützung für das HLS-Protokoll beinhaltet. Ohne diesen speziellen Stream-Schlüssel wird HDR-Content nicht wie gewünscht dargestellt.

## Schritt-für-Schritt: So erstellst du deinen HLS-Stream-Schlüssel

Die Einrichtung erfolgt direkt in den [Einstellungen deines Kanals](/de/creator/), bevor du mit der eigentlichen Übertragung beginnst. Folge diesen Schritten, um deinen Account für HDR-Streaming vorzubereiten:

### 1. Zugriff auf den Live Control Room
Navigiere zunächst in den [Live Control Room](/youtube-tipps-de/einstieg-in-das-live-streaming-auf-youtube/). Dies ist die zentrale Steuereinheit für deine [Live-Übertragungen](/youtube-tipps-de/wie-man-live-streams-beherrscht/), in der du alle technischen Parameter verwalten kannst.

### 2. Einen neuen Schlüssel anlegen
Öffne das Menü und wähle den Punkt „Stream-Schlüssel“ aus. Klicke anschließend auf die Option „Neuen Stream-Schlüssel erstellen“. Da du eventuell verschiedene Setups für unterschiedliche Stream-Qualitäten nutzt, ist es ratsam, dem Schlüssel einen eindeutigen Namen zu geben, damit du ihn später leicht identifizieren kannst.

### 3. Das richtige Protokoll wählen
Dies ist der entscheidende Schritt für die HDR-Funktionalität: Wähle im Dropdown-Menü für das Streaming-Protokoll den Eintrag **HLS Advanced** aus. Erst durch diese Auswahl wird die technische Grundlage geschaffen, um HDR-Inhalte an YouTube zu senden.

### 4. Erstellung abschließen
Nachdem du das Protokoll ausgewählt hast, klicke auf „Erstellen“. Dein neuer HLS-kompatibler Stream-Schlüssel ist nun einsatzbereit und kann in deiner [Streaming-Software](/youtube-tipps-de/obs-mit-twitch-und-youtube-verbinden/) hinterlegt werden.

## Wichtige Caveats bei der Konfiguration

Ein kritischer Punkt bei der Erstellung dieses Schlüssels ist die Auswahl der Optionen: Achte unbedingt darauf, dass du **nicht** die manuellen Optionen aktivierst. Um eine reibungslose Funktion des HLS Advanced-Protokolls zu gewährleisten und HDR korrekt auszusteuern, solltest du dich an den Standardvorgaben dieser Einstellung halten.

Sobald dieser Prozess abgeschlossen ist, kannst du deinen Stream starten und die verbesserte Bildqualität von HDR an deine Community übertragen.
<!-- kwm:article:end -->

<!-- kwm:transcript:start -->
## Transkript

Um in euren Streams HDR korrekt zu zeigen, müsst ihr euren Stream über das HLS-Protokoll senden. Damit YouTube dies korrekt annehmen kann, müsst ihr einen Stream-Tier erstellen, der das HLS-Protokoll unterstützt. Dafür geht ihr vor Stream-Start im [Live Control Room](/youtube-tipps-de/einstieg-in-das-live-streaming-auf-youtube/) auf das Menü, wählt „Stream-Schlüssel“ und klickt auf „Neuen Stream-Schlüssel erstellen“. Dort gebt ihr dem Schlüssel einen Namen und wählt als Streaming-Protokoll HLS Advanced aus. Nachdem ihr auf „Erstellen“ drückt, könnt ihr diesen Schlüssel nutzen, um HDR-Content zu streamen. Wichtig hierbei ist, dass ihr nicht die manuellen Optionen aktiviert.
<!-- kwm:transcript:end -->
