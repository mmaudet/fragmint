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

# +++INS title+++

<br/>

**Préparé pour :** +++INS client+++
**Date :** +++INS date+++
**Référence :** +++INS reference+++

---

## Contexte & Enjeux

+++INS context+++

---

## Notre approche

+++INS approach+++

---

## Fragments clés

+++FOR fragment IN fragments+++
### +++INS $fragment.title+++

+++INS $fragment.body+++

---
+++END-FOR fragment+++

## Équipe & Références

+++INS team+++

---

## Planning

+++INS planning+++

---

## Tarification

| Prestation | Quantité | Prix unitaire | Total |
|-----------|---------|--------------|-------|
+++FOR line IN lines+++
| +++INS $line.description+++ | +++INS $line.qty+++ | +++INS $line.unit_price+++ € | +++INS $line.total+++ € |
+++END-FOR line+++

**Total HT : +++INS total_ht+++ €**
**TVA (20%) : +++INS tva+++ €**
**Total TTC : +++INS total_ttc+++ €**

---

## Prochaines étapes

+++INS next_steps+++

---

# Merci

**+++INS company_name+++**
+++INS contact_email+++
