# Steamworks Inventory Setup

This game now has code-side skin item IDs, local unlock logic, duplicate-copy enhancement logic, and Steam bridge calls ready for Inventory Service.

Live Steam item grants will only work after the matching ItemDefs are created and published in Steamworks for app `4432210`.

## Publish Checklist

1. Open Steamworks for `Conquerors: Domination`.
2. Go to Inventory Service / Item Definitions.
3. Create one ItemDef for each entry in `skin-itemdefs.example.json`.
4. Match these fields exactly:
   - `itemdefid`
   - `name`
   - display name / description
   - tradable / marketable flags
   - hidden flag for `developer_rainbow_skin`
5. Publish the ItemDefs.
6. If any skins should be purchasable, create Store Items using the `store_products` section.
7. Keep reward-only skins as non-store reward grants unless intentionally selling them.
8. Test with a Steam build and confirm `requestInventoryItemGrant` returns success.

## Current Grant Sources

- Ranked season rewards: `4100` to `4105`
- Demo achievement mastery: `4200`
- Leaderboard rewards: `4301`, `4302`, `4303`, `4310`
- Developer-only hidden item: `4999`
- Profile currency: `5100` (`stars_currency`) for Stars-backed profile services such as paid commander name changes

## Enhancement Rule

Copies are counted in-game and enhance skins at:

- `1` copy: normal
- `3` copies: Enhancement `+1`
- `6` copies: Enhancement `+2`
- `9` copies: Enhancement `+3`
- every additional 3 copies continues the enhancement tier
