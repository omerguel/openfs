> **ENTWURF — vor Verwendung anwaltlich prüfen lassen.**
> Diese Vorlage ist eine Arbeitsgrundlage für den Betreiber von OpenFS. Sie ist nicht
> rechtlich geprüft, erhebt keinen Anspruch auf Vollständigkeit und sagt nichts darüber
> aus, ob eine konkrete Verarbeitung datenschutzkonform ist. Platzhalter stehen in
> `[eckigen Klammern]`.

# Vertrag über die Verarbeitung personenbezogener Daten im Auftrag (Art. 28 DSGVO)

zwischen

**[Name der Fahrschule, Rechtsform, Anschrift]**
vertreten durch [Inhaber:in / Geschäftsführung]
— nachfolgend „Verantwortlicher“ —

und

**[Name des Betreibers von OpenFS, Rechtsform, Anschrift]**
vertreten durch [Geschäftsführung]
— nachfolgend „Auftragsverarbeiter“ —

## § 1 Gegenstand des Auftrags

1. Der Auftragsverarbeiter stellt dem Verantwortlichen die Software OpenFS als
   gehosteten Dienst (Software as a Service) zur Verwaltung seines Fahrschulbetriebs
   bereit. Grundlage ist der Nutzungsvertrag vom [Datum] (nachfolgend „Hauptvertrag“).
2. Im Rahmen des Hauptvertrags verarbeitet der Auftragsverarbeiter personenbezogene Daten
   ausschließlich im Auftrag und nach Weisung des Verantwortlichen.

## § 2 Dauer

Dieser Vertrag gilt für die Laufzeit des Hauptvertrags. Er endet automatisch mit dem
Hauptvertrag; die Pflichten nach § 10 (Löschung und Rückgabe) bestehen darüber hinaus fort.

## § 3 Art und Zweck der Verarbeitung

Art der Verarbeitung: Erheben, Erfassen, Speichern, Ordnen, Anzeigen, Übermitteln (z. B.
E-Mail-Versand im Namen des Verantwortlichen), Sichern und Löschen von Daten.

Zweck: Bereitstellung der Funktionen von OpenFS, insbesondere

- Verwaltung von Fahrschülerinnen und Fahrschülern, Verträgen und Preisplänen,
- Terminplanung (Fahrstunden, Theorieunterricht, Prüfungen) und Online-Terminanfragen,
- digitaler Ausbildungsnachweis mit Unterschrift der Fahrschülerin bzw. des Fahrschülers,
- Buchhaltung, Rechnungen, Quittungen, Lastschriften und DATEV-Export,
- Schülerportal und Nachrichten zwischen Fahrschule und Fahrschüler:innen,
- E-Mail-Benachrichtigungen (Terminbestätigungen, Erinnerungen, Zugangslinks),
- Verwaltung von Mitarbeitenden (Fahrlehrer:innen) und Fahrzeugen.

## § 4 Art der Daten

- **Stammdaten:** Name, Geburtsdatum, Führerscheinklassen, Kunden- und Vertragsnummern.
- **Kontaktdaten:** Anschrift, Telefonnummer, E-Mail-Adresse.
- **Vertragsdaten:** Ausbildungsverträge, gebuchte Leistungen, Termine, Ausbildungsstand,
  Prüfungstermine und -ergebnisse, Nachrichten.
- **Abrechnungsdaten:** Rechnungen, Zahlungen, offene Posten, Ratenpläne,
  Bankverbindung und SEPA-Lastschriftmandate.
- **Unterschriften im Ausbildungsnachweis:** gezeichnete Unterschrift der
  Fahrschülerin bzw. des Fahrschülers je Fahrstunde (als Bild gespeichert).
- **Mitarbeiterdaten:** Name, Kontaktdaten, Arbeitszeiten, Einsatzplanung.
- [weitere Datenarten ergänzen, z. B. Sehtest-/Erste-Hilfe-Nachweise, falls erfasst]

## § 5 Kreis der Betroffenen

- Fahrschülerinnen und Fahrschüler sowie Interessent:innen (z. B. über die
  Online-Terminanfrage),
- Erziehungsberechtigte minderjähriger Fahrschüler:innen,
- Mitarbeitende des Verantwortlichen (insbesondere Fahrlehrer:innen und Büropersonal).

## § 6 Pflichten des Auftragsverarbeiters

1. Der Auftragsverarbeiter verarbeitet die Daten nur auf dokumentierte Weisung des
   Verantwortlichen (Art. 28 Abs. 3 lit. a DSGVO), es sei denn, er ist gesetzlich zu einer
   Verarbeitung verpflichtet; in diesem Fall teilt er dies vorab mit, soweit zulässig.
2. Er verpflichtet alle Personen, die Zugang zu den Daten haben, zur Vertraulichkeit.
3. Er trifft die technischen und organisatorischen Maßnahmen nach § 7.
4. Er unterstützt den Verantwortlichen bei der Erfüllung von Betroffenenrechten
   (Art. 12–22 DSGVO) sowie bei den Pflichten nach Art. 32–36 DSGVO.
5. Er meldet dem Verantwortlichen Verletzungen des Schutzes personenbezogener Daten
   unverzüglich, spätestens innerhalb von [24/48] Stunden nach Kenntnis.
6. Er stellt dem Verantwortlichen die Informationen zum Nachweis der Einhaltung dieser
   Pflichten zur Verfügung und ermöglicht Überprüfungen nach vorheriger Abstimmung.

## § 7 Technische und organisatorische Maßnahmen (Art. 32 DSGVO)

Die folgende Aufstellung beschreibt Maßnahmen, die in der Software bzw. im geplanten
Betrieb vorgesehen sind. Der Umsetzungsstand ist vor Vertragsschluss zu prüfen und in
einer Anlage zu dokumentieren.

**Vertraulichkeit**

- Zugang zur Verwaltungsoberfläche nur nach Anmeldung; Passwörter werden ausschließlich
  als Hash gespeichert, Anmeldungen über serverseitige Sitzungen (Session-Cookie).
  [Umsetzungsstand prüfen]
- Mandantentrennung: je Fahrschule eine eigene Datenbank (physische Trennung).
  [Umsetzungsstand prüfen]
- Schülerportal nur über einen zufällig erzeugten, persönlichen Zugangslink
  (256 Bit Zufall), der jederzeit gesperrt und neu ausgestellt werden kann.
- Öffentliche Schnittstellen (Terminanfrage, Schülerportal) mit Begrenzung der
  Anfragen je IP-Adresse.
- Transportverschlüsselung (HTTPS/TLS) für den Webzugriff; E-Mail-Versand über SMTP mit
  TLS bzw. STARTTLS. [Konfiguration im Betrieb bestätigen]
- Zutritts- und Zugangskontrolle beim Rechenzentrumsbetreiber: [Nachweis des
  Unterauftragsverarbeiters beifügen]

**Integrität**

- Buchungen in der Buchhaltung sind unveränderbar; Korrekturen erfolgen nur per Storno
  mit lückenloser Belegnummernfolge.
- Unterschriften im Ausbildungsnachweis werden zusammen mit einem Namens-Schnappschuss
  der Fahrlehrerin bzw. des Fahrlehrers gespeichert.

**Verfügbarkeit und Belastbarkeit**

- Fortlaufende Replikation der Datenbank als Sicherung in einen Objektspeicher
  (Litestream-ähnliches Verfahren). [Umsetzungsstand, Aufbewahrung der Sicherungen und
  Wiederherstellungstests ergänzen]
- Hosting auf Servern in Deutschland (Hetzner). [Rechenzentrumsstandort bestätigen]

**Verfahren zur regelmäßigen Überprüfung**

- Automatisierte Tests und Sicherheitsprüfung der verwendeten Bibliotheken
  (Abhängigkeits-Audit) bei jeder Änderung der Software.
- [Weitere organisatorische Maßnahmen ergänzen, z. B. Rechte- und Rollenkonzept,
  Schulung, Incident-Prozess]

## § 8 Unterauftragsverarbeiter

1. Der Verantwortliche stimmt der Beauftragung der folgenden Unterauftragsverarbeiter zu:

   | Unterauftragsverarbeiter | Anschrift | Leistung | Ort der Verarbeitung |
   |---|---|---|---|
   | Hetzner Online GmbH | [Anschrift] | Serverhosting, Objektspeicher (Sicherungen, Dokumente) | [Deutschland — Standort bestätigen] |
   | [E-Mail-Versanddienst] | [Anschrift] | Versand von E-Mails | [Ort] |

2. Der Auftragsverarbeiter informiert den Verantwortlichen vorab über beabsichtigte
   Änderungen; der Verantwortliche kann innerhalb von [30] Tagen aus wichtigem
   datenschutzrechtlichem Grund widersprechen.
3. Der Auftragsverarbeiter erlegt Unterauftragsverarbeitern dieselben
   Datenschutzpflichten auf, die in diesem Vertrag festgelegt sind.

## § 9 Weisungen

1. Weisungen erteilt der Verantwortliche grundsätzlich in Textform. Mündliche Weisungen
   bestätigt er unverzüglich in Textform.
2. Weisungsberechtigte Personen des Verantwortlichen: [Name, Kontakt].
   Weisungsempfänger beim Auftragsverarbeiter: [Name, Kontakt].
3. Ist der Auftragsverarbeiter der Ansicht, dass eine Weisung gegen Datenschutzvorschriften
   verstößt, weist er den Verantwortlichen unverzüglich darauf hin.

## § 10 Löschung und Rückgabe

1. Nach Ende des Hauptvertrags stellt der Auftragsverarbeiter dem Verantwortlichen auf
   Wunsch sämtliche Daten als vollständigen Export zur Verfügung (die Datenbankdatei der
   Fahrschule sowie [weitere Formate, z. B. CSV, DATEV-Export]).
2. Anschließend löscht der Auftragsverarbeiter die Daten innerhalb von [30] Tagen,
   einschließlich der Sicherungen nach Ablauf von deren Aufbewahrungszeitraum von
   [X] Tagen, und bestätigt die Löschung in Textform.
3. Gesetzliche Aufbewahrungspflichten des Verantwortlichen (z. B. § 147 AO, § 257 HGB)
   erfüllt der Verantwortliche selbst anhand des Exports, sofern nicht gesondert eine
   Archivierung durch den Auftragsverarbeiter vereinbart ist.

## § 11 Schlussbestimmungen

1. Änderungen und Ergänzungen bedürfen der Textform.
2. Im Fall von Widersprüchen gehen die Regelungen dieses Vertrags zum Datenschutz denen
   des Hauptvertrags vor.
3. Sollte eine Bestimmung unwirksam sein, bleibt die Wirksamkeit der übrigen unberührt.

[Ort, Datum] — Verantwortlicher

[Ort, Datum] — Auftragsverarbeiter

**Anlagen:** Anlage 1 — Technische und organisatorische Maßnahmen (Umsetzungsstand),
Anlage 2 — Liste der Unterauftragsverarbeiter
