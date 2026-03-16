---
marp: true
theme: default
paginate: true
style: |
  section { font-size: 24px; }
  h1 { color: #2B579A; }
  h2 { color: #2B579A; }
---

# LinCloud Souverain
## Proposition pour +++INS metadata.client+++
+++INS metadata.date+++

---

## Contexte

+++INS fragments.introduction.body+++

---

+++FOR arg IN fragments.arguments+++

## +++INS $arg.title+++

+++INS $arg.body+++

---

+++END-FOR arg+++

## Tarification

| Service | Description | Qté | P.U. | Total |
|---------|-------------|-----|------|-------|
+++FOR l IN lignes+++| +++INS $l.service+++ | +++INS $l.description+++ | +++INS $l.quantite+++ | +++INS $l.prix_unitaire+++ | +++INS $l.total+++ |
+++END-FOR l+++| | | | **Total HT** | **+++INS metadata.total_ht+++ €** |
| | | | **TVA 20%** | **+++INS metadata.tva+++ €** |
| | | | **Total TTC** | **+++INS metadata.total_ttc+++ €** |

---

## Références

+++INS fragments.references.body+++

---

## Conclusion

+++INS fragments.conclusion.body+++

---

# Merci
## +++INS metadata.client+++
**LINAGORA** — LinCloud Souverain
