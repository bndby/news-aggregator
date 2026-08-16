-- Re-queue Russian rows that were stored as a copy of the English source.
DELETE FROM translations
WHERE lang = 'ru'
  AND article_id IN (
    SELECT t.article_id
    FROM translations t
    JOIN translations s ON s.article_id = t.article_id AND s.lang = 'en'
    WHERE t.lang = 'ru'
      AND t.title = s.title
      AND t.summary = s.summary
  );
