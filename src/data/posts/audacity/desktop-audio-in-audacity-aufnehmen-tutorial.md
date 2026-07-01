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
image: "https://i.ytimg.com/vi/VB0-XfW6lms/maxresdefault.jpg"
authorName: "Leo Wattenberg"
sourceUrl: "https://www.youtube.com/watch?v=VB0-XfW6lms"
video:
  youtubeId: "VB0-XfW6lms"
  embedUrl: "https://www.youtube.com/embed/VB0-XfW6lms"
  watchUrl: "https://www.youtube.com/watch?v=VB0-XfW6lms"
  thumbnailUrl: "https://i.ytimg.com/vi/VB0-XfW6lms/maxresdefault.jpg"
---

## Transkript

Um Desktop-Audio in Audacity aufzunehmen, gehe zu Audio Setup > Host und stelle den Host auf Windows WASAPI. Bei Mac oder Linux ist das deutlich komplizierter, und darauf werde ich in diesem Tutorial nicht eingehen.

Sobald du das gemacht hast, findest du deine Wiedergabegerate jetzt auch im Bereich der Aufnahmegerate, allerdings mit "loopback" dahinter. Das sind deine Lautsprecher, die jetzt aber wie ein Mikrofon funktionieren. Du solltest das Gerat auswahlen, das deiner tatsachlichen Ausgabe entspricht. Wenn du dir nicht sicher bist, welches die richtige Auswahl ist, kannst du hier unten auf das Lautsprecher-Symbol und dann auf dieses andere Lautsprecher-Symbol gehen. Dort ist die passende Auswahl bereits ausgewahlt, und genau diese musst du dann auch in Audacity auswahlen, nur eben mit "loopback" dahinter.

Wahle ausserdem bei den Aufnahmekanalen Stereo aus, da all diese Ausgaben stereo sind. Wenn du jetzt auf Aufnahme druckst, wirst du sehen, dass nicht viel passiert. Das ist Absicht, denn Audacity wartet jetzt auf ein Eingangssignal. Wenn du nun Audio abspielst, beginnt Audacity damit, dieses Audio fur dich aufzunehmen. Wenn du das Audio stoppst, stoppst du damit auch die Aufnahme.

Wenn du stattdessen Audio kontinuierlich aufnehmen mochtest, musst du zuerst diese Aufnahme entfernen und dann zusatzlich zu der Spur, in die du aufnehmen willst, eine weitere Spur hinzufugen. Stelle sicher, dass unter Transport > Transport Options die Option "Overdub" aktiviert ist. Sie ist standardmassig aktiviert. Stelle ausserdem sicher, dass dein Wiedergabegerat dasselbe ist wie dein Aufnahmegerat. Wenn diese beiden nicht zusammenpassen, bekommst du stattdessen irgendeine kryptische Fehlermeldung wie -9997 oder ein anderes unerwunschtes Verhalten. Wenn diese beiden aber gleich sind, nimmt Audacity jetzt dein Desktop-Audio auf. Wenn ich die Datei jetzt wieder abspiele, siehst du, dass es einfach kontinuierlich funktioniert.

Wenn du an dieser Stelle auf andere Fehlermeldungen stosst, musst du stattdessen in deine Audioeinstellungen gehen. Dort findest du die Projektvorlage. Diese Abtastrate kannst du mit deinen Audiogeraten abgleichen, die du wiederum uber das Lautsprecher-Symbol > weitere Lautstarkeeinstellungen findest. Hier findest du fur den betreffenden Lautsprecher den passenden Wert. In meinem Fall sind es 44,1 kHz, was meiner Projektrate entspricht. Das Sample-Format ist ubrigens nicht wichtig, und du solltest es in Audacity normalerweise bei 32-Bit-Float lassen, weil das auch das Format ist, das alle Effekte verwenden.

Das war alles, was ich fur dich in diesem Tutorial habe. Wenn du Fragen hast, kannst du sie im Discord oder im Forum stellen. Eine aktualisierte Version dieser Anleitung findest du uber den Link in der Beschreibung. Und damit: Mach's gut und tschuss!
