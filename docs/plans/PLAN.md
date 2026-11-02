# Bezahlvorschau Family Travel Business

Ziel: Dirk Adams zeigen, wie das Vermittlermodell mit Stripe Connect (Direct Charges) für Kunden, Mitglieder und Betreiber aussieht, bevor die LLC ein Stripe-Konto hat. Statische Seite, Stripe nur simuliert, live auf GitHub Pages.

## Stand (02.11.2026)

- Startumfang laut Dirk (02.11.): Buchung von Coachings, Trainings und Workshops; fertige digitale Produkte vorerst nicht
- Entdecken, Angebot mit Terminwahl (1:1-Termine, Gruppentermine mit Plätzen), Kasse mit Testkarten, Aufteilung der Zahlung
- Demodaten relativ zu heute; Mitglied „Andreas Klassen“ mit Face Reading per Zoom (499 €, Paare 799 €)
- Mitglied werden: Anmeldung führt durch Gebühr, Verifizierung, Freigabe und erstes Angebot
- Mein Bereich: Angebote mit Art/Dauer/Ort, Termine anlegen/löschen (nur ohne Buchungen), Buchungen mit Termin; Einrichtungsgebühr, Verifizierung (Nachbau des Stripe-Ablaufs inkl. Adressnachweis), Angebote anlegen/bearbeiten/löschen, Verkäufe, Profil
- Verwaltung: Kennzahlen, Mitglieder freigeben/sperren/löschen (löschen nur ohne Verkäufe, nie das letzte), Provision/Gebühr, CSV-Export
- Anleitung „So verkaufst du“
- Tests: `node tests/check.mjs` (Speicher, Escaping, Verifizierung, CSP-Hash)

## Threat Model (Vorschau)

**Angreifer-Szenarien**
- Fremde Seite unter `klassenmedia.github.io` schreibt präparierte Daten in den gemeinsamen localStorage (gleicher Origin), um Skript einzuschleusen.
- Besucher hält die öffentliche Vorschau für echt und tippt echte Ausweis-, Bank- oder Kartendaten ein.
- Besucher manipuliert in den DevTools `data-id` oder den URL-Hash, um Abläufe zu überspringen.

**Untrusted Inputs und Gegenmaßnahme**
| Input | Gegenmaßnahme |
|---|---|
| localStorage `ftb-vorschau-v1` | `isValidState` prüft Struktur, IDs, Zahlen, Datumswerte; sonst Testdaten |
| Formularfelder (Anmeldung, Angebot, Profil, Kasse, Verifizierung) | `escapeHtml` vor jedem `innerHTML`, Längenbegrenzung/Kürzung, Bereichs-Allowlist, Wertebereiche |
| URL-Hash | Routen per `Object.hasOwn`, unbekannte IDs → „Seite gibt es nicht“ |
| `data-id` in Aktionen | Allowlists (`SAMPLE_FIELDS`, `SELLER_KINDS`, `DOC_TYPES`), Verifizierung an `memberId` gebunden |
| Kartennummer | nur die zwei Testkarten werden angenommen |
| Termin-ID in der URL / Termindaten | `isDateBookable` vor Kasse, beim Absenden und nach der Zahlung; Datum ab morgen, Uhrzeit-Muster, Plätze 1–500, keine Dubletten; nur eigene Angebote änderbar |

**Worst Case:** Ein Besucher gibt echte Daten ein. Abgemildert: keine Speicherung der Verifizierungsdaten, kein Netzwerkzugriff (CSP `default-src 'none'`, `form-action 'none'`), kein Datei-Upload, Hinweise „keine echten Daten“ bei Person, Bank, Kasse, Testmodus-Banner.

## Bewusst akzeptiert (nur Vorschau)

- Doppelbuchung bei Wegnavigieren während der Zahlung, Preisänderung während der Zahlung
- Review 02.11. (Mitglied werden): Doppel-Absenden legt zwei Mitglieder an; keine Obergrenze für Mitglieder; Escaping in Lösch-Dialog und Vorführhinweis ohne eigenen Test; Dialogtext nennt Gebühr auch wenn unbezahlt
- Gemeinsamer Origin `klassenmedia.github.io` (eigene Subdomain erst für den echten Bau)
- Review 02.11.: setupPaid-Prüfung im Timeout und Submit-Absicherung ohne eigenen Test

## Offen vor dem echten Bau

- Stripe-Konto der LLC (US-Bankkonto, Wohnadresse Dirk), Cross-Border Direct Charges mit Stripe klären
- DAC7-Registrierung in einem EU-Staat, Steuer-Wohnsitz Dirk, Pauschalreise/Sicherungsschein bei Reise-Angeboten
- Gelöschte Mitglieder: Zahlungsdaten (Einrichtungsgebühr) für die Buchhaltung aufbewahren statt löschen
- Platzvergabe serverseitig mit Sperre (zwei gleichzeitige Käufer), Stripe-Zahlung erst nach Reservierung; Kalender-Export/Zoom-Link automatisch
- Freigabe- und Zahlungslogik serverseitig; Stripe-Webhooks mit Signaturprüfung; CoachKraft-Connect-Plan als Vorlage
