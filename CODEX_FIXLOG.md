2026-06-22: Fixed `completeService()` double-click race by atomically moving pending services to done before creating income transactions.
2026-06-22: Fixed completed-service price retry path so linked income transaction amount is updated instead of silently returning stale finance data.
2026-06-22: Fixed service soft-delete to also soft-delete the linked income transaction, keeping balance consistent with deleted services.
2026-06-22: Fixed client phone soft-delete collision by restoring deleted clients on reuse and rejecting active duplicate phone updates with 409.
2026-06-22: Added strict service/finance input validation for invalid dates, negative/NaN amounts, bad phone numbers, and missing service locations.
2026-06-22: Added API error normalization for Mongoose CastError/ValidationError/duplicate-key errors so bad input returns 400/409 instead of 500.
2026-06-22: Added Telegram file/image fetch timeouts and SSE AI search error events so external API failures do not leave requests hanging.
2026-06-22: Restricted reminder deletion to active services only.
