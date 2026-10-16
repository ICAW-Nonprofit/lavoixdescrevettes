-- First action, imported from the original site (only if it isn't there yet).
insert into public.events (id, slug, status, kind, title, title_en, target, starts_at, ends_at, street, postal_code, city, lat, lng, meeting_point, access, access_en, summary, summary_en, description, description_en, share_text, share_text_en, whatsapp_url, flyer_tagline, flyer_place, custom_poster, poster_alt, recap_participants, recap_text, recap_links)
values ('8a3f6d2e-4b1c-4e7a-9c55-0d2b7e6f1a01', 'action-lidl-chatenay-malabry-4-novembre-2026', 'published', 'rassemblement', 'Action devant le siège de Lidl', 'Action at Lidl''s headquarters', 'Lidl', '2026-11-04T10:00:00+00:00', '2026-11-04T11:30:00+00:00', '35 avenue Sully Prudhomme', '92290', 'Châtenay-Malabry', 48.76668, 2.28968, null, 'RER B ou tram T10', 'RER B or T10 tram', 'On retourne devant le siège de Lidl pour exiger que l''enseigne arrête d''asphyxier les crevettes.', 'We''re going back to Lidl''s headquarters to demand that the retailer stops suffocating shrimp.', 'Les crevettes vendues chez Lidl sont tuées par **asphyxie**. Sorties de l''eau, elles suffoquent, leurs branchies se dessèchent, elles se débattent et peuvent mettre de longues minutes, parfois des heures, à mourir. Les crevettes ressentent la douleur.

Lidl s''est déjà engagé à mettre fin à l''épédonculation (l''ablation des yeux des crevettes reproductrices). C''est un premier pas, mais rien n''a été promis contre l''asphyxie.

On demande à Lidl d''arrêter d''asphyxier les crevettes. Après une première action devant son siège, on y retourne le 4 novembre.

Viens seul·e ou à plusieurs, et n''hésite pas à partager l''événement. Laisse-nous un message sur Instagram et on t''envoie le lien de notre groupe WhatsApp.', 'The shrimp sold at Lidl are killed by **asphyxiation**. Taken out of the water, they suffocate, their gills dry out, they struggle, and they can take long minutes, sometimes hours, to die. Shrimp feel pain.

Lidl has already committed to ending eyestalk ablation (cutting the eyes off breeding females). It''s a first step, but nothing has been promised against asphyxiation.

We''re asking Lidl to stop suffocating shrimp. After a first action at its headquarters, we''re going back on 4 November.

Come alone or bring friends, and please share the event. Send us a message on Instagram and we''ll send you the link to our WhatsApp group.', 'On retourne devant le siège de Lidl pour exiger que l''enseigne arrête d''asphyxier les crevettes. Sorties de l''eau, elles suffoquent et peuvent agoniser de longues minutes, parfois des heures : les crevettes ressentent la douleur.

Manifester est l''un des moyens d''action les plus efficaces. Militant·e chevronné·e ou novice, tout le monde est bienvenu : viens, et fais tourner !', 'We''re going back to Lidl''s headquarters to demand that the retailer stops suffocating shrimp. Taken out of the water, they suffocate and can struggle for long minutes, sometimes hours: shrimp feel pain.

Demonstrating is one of the most effective ways to act. Seasoned activist or first-timer, everyone is welcome: come along, and spread the word!', null, null, null, '/posters/action-lidl-chatenay-malabry-4-novembre-2026.webp', 'Affiche « Action pour les crevettes » : mercredi 4 novembre, 11 h, RDV 35 avenue Sully Prudhomme', null, null, null)
on conflict (slug) do nothing;
