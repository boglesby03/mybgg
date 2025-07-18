import io
import re
import time
from .http_client import make_http_request

import colorgram
import requests
from algoliasearch.search.client import SearchClientSync
from PIL import Image, ImageFile
from .vendor import colorgram

# Allow PIL to read truncated files
ImageFile.LOAD_TRUNCATED_IMAGES = True

class Indexer:

    def __init__(self, app_id, apikey, index_name, hits_per_page):

        self.client = SearchClientSync(
            app_id=app_id,
            api_key=apikey,
        )

        # index = client.init_index(index_name)

        self.client.set_settings(
            index_name=index_name,
            index_settings= {
                'searchableAttributes': [
                    'name',
                    'alternate_names',
                    'expansions.name',
                    'accessories.name',
                    'description',
                    'comment',
                    'wishlist_comment',
                    'designers.name',
                    'artists.name',
                    'publishers.name',
                    'categories',
                    'families.name',
                    'reimplements.name',
                    'reimplementedby.name',
                    'integrates.name'
                ],
                'attributesForFaceting': [
                    'searchable(categories)',
                    'searchable(mechanics)',
                    'searchable(publishers.name)',
                    'searchable(designers.name)',
                    'searchable(artists.name)',
                    'players',
                    'weight',
                    'playing_time',
                    'min_age',
                    'searchable(previous_players)',
                    'numplays',
                    'searchable(year)',
                    'tags',
                    "wishlist_priority"
                ],
                'customRanking': ['asc(name)'],
                'highlightPreTag': '<strong class="highlight">',
                'highlightPostTag': '</strong>',
                'hitsPerPage': hits_per_page,
            },
            forward_to_replicas=True,
            )

        self._init_replicas(self.client, index_name)

        self.index = index_name

    def _init_replicas(self, client, mainIndex):

        client.set_settings(
            index_name = mainIndex,
            index_settings = {
                'replicas': [
                    mainIndex + '_rank_ascending',
                    mainIndex + '_numrated_descending',
                    mainIndex + '_numowned_descending',
                    mainIndex + '_lastmod_descending',
                ]
            },
        )

        client.set_settings(
            index_name = mainIndex + '_rank_ascending',
            index_settings = {
                'ranking': ['asc(rank)']
            },
        )

        client.set_settings(
            index_name = mainIndex + '_numrated_descending',
            index_settings = {
                'ranking': ['desc(usersrated)']
            },
        )

        client.set_settings(
            index_name = mainIndex + '_numowned_descending',
            index_settings = {
                'ranking': ['desc(numowned)']
            },
        )

        client.set_settings(
            index_name = mainIndex + '_lastmod_descending',
            index_settings = {
                'ranking': ['desc(lastmodified)']
            },
        )

    @staticmethod
    def todict(obj):
        if isinstance(obj, str):
            return obj

        elif isinstance(obj, dict):
            return dict((key, Indexer.todict(val)) for key, val in obj.items())

        elif hasattr(obj, '__iter__'):
            return [Indexer.todict(val) for val in obj]

        elif hasattr(obj, '__dict__'):
            return Indexer.todict(vars(obj))

        return obj

    def _facet_for_num_player(self, num, type_):
        num_no_plus = num.replace("+", "")
        facet_types = {
            "b": {
                "level1": num_no_plus,
                "level2": f"{num_no_plus} > Best with {num}",
            },
            "rec": {
                "level1": num_no_plus,
                "level2": f"{num_no_plus} > Recommended with {num}",
            },
            "sup": {
                "level1": num_no_plus,
                "level2": f"{num_no_plus} > Supports with {num}",
            },
            "exp": {
                "level1": num_no_plus,
                "level2": f"{num_no_plus} > Expansion allows {num}",
            },
            "exp_s": {
                "level1": num_no_plus,
                "level2": f"{num_no_plus} > ExpansionSupport allows {num}",
            },
        }

        return facet_types[type_]

    def _smart_truncate(self, content, length=700, suffix='...'):
        if len(content) <= length:
            return content
        else:
            return ' '.join(content[:length + 1].split(' ')[0:-1]) + suffix

    def _pick_long_paragraph(self, content):
        content = content.strip()
        if "\n\n" not in content:
            return content

        paragraphs = content.split("\n\n")
        for paragraph in paragraphs[:3]:
            paragraph = paragraph.strip()
            if len(paragraph) > 80:
                return paragraph

        return content

    def _prepare_description(self, description):
        # Try to find a long paragraph from the beginning of the description
        description = self._pick_long_paragraph(description)

        # Remove unnecessary spacing
        description = re.sub(r"\s+", " ", description)

        # Cut at 700 characters, but not in the middle of a sentence
        description = self._smart_truncate(description)

        return description

    @staticmethod
    def _minimize_field(game, field, columns=["id", "name"]):
        return [
                {
                    attribute: accessory[attribute]
                    for attribute in columns
                }
                for accessory in game[field]
            ]

    @staticmethod
    def _remove_game_name_prefix(expansion_name, game_name):
        def remove_prefix(text, prefix):
            if text.startswith(prefix):
                return text[len(prefix):]

        # Expansion name: Catan: Cities & Knights
        # Game name: Catan
        # --> Cities & Knights
        if game_name + ": " in expansion_name:
            return remove_prefix(expansion_name, game_name + ": ")

        # Expansion name: Shadows of Brimstone: Outlaw Promo Cards
        # Game name: Shadows of Brimstone: City of the Ancients
        # --> Outlaw Promo Cards
        elif ":" in game_name:
            game_name_prefix = game_name[0:game_name.index(":")]
            if game_name_prefix + ": " in expansion_name:
                return expansion_name.replace(game_name_prefix + ": ", "")

        return expansion_name

    def fetch_image(self, url, tries=0):
        try:
            response = make_http_request(url)
            return response
        except Exception as e:
            if tries < 3:
                time.sleep(2)
                return self.fetch_image(url, tries=tries + 1)
            raise e

    def add_objects(self, collection):
        games = [Indexer.todict(game) for game in collection]
        for i, game in enumerate(games):
            if i != 0 and i % 25 == 0:
                print(f"Indexed {i} of {len(games)} games...")

            if game["image"]:
                image_data = self.fetch_image(game["image"])
                if image_data:
                    image = Image.open(io.BytesIO(image_data)).convert('RGBA')

                    try_colors = 10
                    colors = colorgram.extract(image, try_colors)
                    for i in range(min(try_colors, len(colors))):
                        color_r, color_g, color_b = colors[i].rgb.r, colors[i].rgb.g, colors[i].rgb.b

                        # Don't return very light or dark colors
                        luma = (
                            0.2126 * color_r / 255.0 +
                            0.7152 * color_g / 255.0 +
                            0.0722 * color_b / 255.0
                        )
                        if (
                            luma > 0.2 and  # Not too dark
                            luma < 0.8     # Not too light
                        ):
                            break

                    else:
                        # As a fallback, use the first color
                        color_r, color_g, color_b = colors[0].rgb.r, colors[0].rgb.g, colors[0].rgb.b

                    game["color"] = f"{color_r}, {color_g}, {color_b}"

            game["objectID"] = f"bgg{game['collection_id']}"

            # Turn players tuple into a hierarchical facet
            game["players"] = [
                self._facet_for_num_player(num, type_)
                for num, type_ in game["players"]
            ]

            # Algolia has a limit of 10kb per item, so remove unnecessary data from expansions
            # attribute_map = {
            #     "id": lambda x: x,
            #     "name": lambda x: self._remove_game_name_prefix(x, game["name"]),
            #     "players": lambda x: x or None,
            # }
            # game["expansions"] = [
            #     {
            #         attribute: func(expansion[attribute])
            #         for attribute, func in attribute_map.items()
            #         if func(expansion[attribute])
            #     }
            #     for expansion in game["expansions"]
            # ]

            game["expansions"] = self._minimize_field(game, "expansions", ["id", "name", "players"]) #, "tags"])
            game["accessories"] = self._minimize_field(game, "accessories") # ["id", "name", "tags"])
            game["reimplements"] = self._minimize_field(game, "reimplements")
            game["reimplementedby"] = self._minimize_field(game, "reimplementedby")
            game["designers"] = self._minimize_field(game, "designers")
            game["publishers"] = self._minimize_field(game, "publishers")
            game["artists"] = self._minimize_field(game, "artists")
            game["wl_exp"] = self._minimize_field(game, "wl_exp")
            game["wl_acc"] = self._minimize_field(game, "wl_acc")
            game["po_exp"] = self._minimize_field(game, "po_exp")
            game["po_acc"] = self._minimize_field(game, "po_acc")

            try:
                self.client.add_or_update_object(
                    index_name = self.index,
                    object_id = game["objectID"],
                    body = game
                )
            except Exception as e:
                print(f'Error occurred: {e}')
                print(game)


    def delete_objects_not_in(self, collection):
        delete_filter = " AND ".join([f"id != {game.id}" for game in collection])
        self.client.delete_by(
            index_name = self.index,
            delete_by_params = {
              'filters': delete_filter,
            },
        )
