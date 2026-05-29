---
marp: true
theme: default
paginate: true
backgroundColor: #fff
style: |
  section {
    font-family: "Calibri", sans-serif;
    font-size: 28px;
  }
  h1 { color: #1a237e; font-size: 40px; }
  h2 { color: #283593; font-size: 32px; }
  .lead { font-size: 22px; color: #555; }
  table { font-size: 22px; }
---

# +++INS metadata.title+++

<br/>

**Préparé pour :** +++INS metadata.client+++
**Date :** +++INS metadata.date+++
**Référence :** +++INS metadata.reference+++

---

## Contexte & Enjeux

+++INS metadata.context+++

---

## Notre approche

+++INS metadata.approach+++

---

## Fragments clés

+++FOR fragment IN fragments+++
### +++INS $fragment.title+++

+++INS $fragment.body+++

---
+++END-FOR fragment+++

## Équipe & Références

+++INS metadata.team+++

---

## Planning

+++INS metadata.planning+++

---

## Tarification

| Prestation | Quantité | Prix unitaire | Total |
|-----------|---------|--------------|-------|
+++FOR line IN lines+++
| +++INS $line.description+++ | +++INS $line.qty+++ | +++INS $line.unit_price+++ € | +++INS $line.total+++ € |
+++END-FOR line+++

**Total HT : +++INS metadata.total_ht+++ €**
**TVA (20%) : +++INS metadata.tva+++ €**
**Total TTC : +++INS metadata.total_ttc+++ €**

---

## Prochaines étapes

+++INS metadata.next_steps+++

---

# Merci

**+++INS metadata.company_name+++**
+++INS metadata.contact_email+++
