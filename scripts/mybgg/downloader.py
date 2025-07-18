import copy
import itertools
import re

from mybgg.bgg_client import BGGClient
from mybgg.bgg_client import CacheBackendSqlite
from mybgg.models import BoardGame

from datetime import datetime
from multidict import MultiDict

DATE_FORMAT = "%Y-%m-%d"

EXTRA_EXPANSIONS_GAME_ID=81913
UNPUBLISHED_PROTOTYPE=18291
BOX_OF_PROMOS=39378

class Downloader():
    def __init__(self, cache_bgg, token, debug=False):
        if cache_bgg:
            self.client = BGGClient(
                cache=CacheBackendSqlite(
                    path=f"mybgg-cache.sqlite",
                    ttl=60 * 60 * 24,
                ),
                token=token,
                debug=debug,
            )
        else:
            self.client = BGGClient(
                token=token,
                debug=debug,
            )

    def collection(self, user_name, extra_params):
        collection_data = []
        plays_data = []

        if isinstance(extra_params, list):
            for params in extra_params:
                collection_data += self.client.collection(
                    user_name=user_name,
                    **params,
                )
        else:
            collection_data = self.client.collection(
                user_name=user_name,
                **extra_params,
            )

        # Filter collection to the types we're interested in
        # TODO Externalize this
        filtered_tags = ['own', 'preordered', 'wishlist']
        collection_data = list(filter(lambda item: any(tag in filtered_tags for tag in item.get("tags", [])), collection_data))

        # Dummy game for linking extra promos and accessories
        collection_data.append(_create_blank_collection(EXTRA_EXPANSIONS_GAME_ID, "ZZZ: Expansions without Game (A-I)"))

        params = {"subtype": "boardgameaccessory"}
        accessory_collection = self.client.collection(user_name=user_name, **params)
        accessory_collection = list(filter(lambda item: any(tag in filtered_tags for tag in item.get("tags", [])), accessory_collection))

        accessory_list_data = self.client.game_list([game_in_collection["id"] for game_in_collection in accessory_collection])
        accessory_collection_by_id = MultiDict()
        for acc in accessory_collection:
            accessory_collection_by_id.add(str(acc["id"]), acc)

        plays_data = self.client.plays(
            user_name=user_name,
        )

        game_list_data = self.client.game_list([game_in_collection["id"] for game_in_collection in collection_data])

        collection_by_id = MultiDict();
        for item in collection_data:
            item["players"] = []
            collection_by_id.add(str(item["id"]), item)

        for play in plays_data:
            play_id = str(play["game"]["gameid"])
            if play_id in collection_by_id:
                play_date = datetime.strptime(play["played_date"], DATE_FORMAT)
                collection_by_id[play_id]["players"].extend(play["players"])

                current_last_played = collection_by_id[play_id].get("last_played")
                if current_last_played is None or play_date > current_last_played:
                    collection_by_id[play_id]["last_played"] = play_date

                current_first_played = collection_by_id[play_id].get("first_played")
                if current_first_played is None or play_date < current_first_played:
                    collection_by_id[play_id]["first_played"] = play_date

        games_data = list(filter(lambda x: x["type"] == "boardgame", game_list_data))
        expansions_data = list(filter(lambda x: x["type"] == "boardgameexpansion", game_list_data))

        game_data_by_id = {}
        expansion_data_by_id = {}

        for game in games_data:
            game["accessories_collection"] = []
            game["expansions_collection"] = []
            game_data_by_id[game["id"]] = game

            if game["id"] == UNPUBLISHED_PROTOTYPE:
                expansions_data.append(game)

        for expansion in expansions_data:
            expansion["accessories_collection"] = []
            expansion["expansions_collection"]  = []
            expansion_data_by_id[expansion["id"]] = expansion

        expansion_data_by_id = custom_expansion_mappings(expansion_data_by_id)

        for expansion_data in expansion_data_by_id.values():

            if is_promo_box(expansion_data):
                game_data_by_id[expansion_data["id"]] = expansion_data
            for expansion in expansion_data["expansions"]:
                id = expansion["id"]
                if expansion["inbound"] and id in expansion_data_by_id:
                    expansion_data_by_id[id]["expansions_collection"].append(expansion_data)

        accessory_list_data = custom_accessories_mapping(accessory_list_data)

        for accessory_data in accessory_list_data:
            own_game = False
            for accessory in accessory_data["accessories"]:
                id = accessory["id"]
                if accessory["inbound"]:
                    if id in game_data_by_id:
                        game_data_by_id[id]["accessories_collection"].append(accessory_data)
                        own_game = True
                    elif id in expansion_data_by_id:
                        expansion_data_by_id[id]["accessories_collection"].append(accessory_data)
                        own_game = True
            if not own_game:
                game_data_by_id[EXTRA_EXPANSIONS_GAME_ID]["accessories_collection"].append(accessory_data)

        for expansion_data in expansion_data_by_id.values():
            own_base_game = False
            for expansion in expansion_data["expansions"]:
                id = expansion["id"]
                if expansion["inbound"]:
                    if id in game_data_by_id:
                        own_base_game = True
                        if not is_promo_box(expansion_data):
                            game_data_by_id[id]["expansions_collection"].append(expansion_data)
                            game_data_by_id[id]["expansions_collection"].extend(expansion_data_by_id[expansion_data["id"]]["expansions_collection"])
                            game_data_by_id[id]["accessories_collection"].extend(expansion_data_by_id[expansion_data["id"]]["accessories_collection"])
                    elif id in expansion_data_by_id:
                        own_base_game = True
            if not own_base_game:
                id = EXTRA_EXPANSIONS_GAME_ID
                expansion_data["suggested_numplayers"] = []
                game_data_by_id[id]["expansions_collection"].append(expansion_data)
                game_data_by_id[id]["expansions_collection"].extend(expansion_data_by_id[expansion_data["id"]]["expansions_collection"])
                game_data_by_id[id]["accessories_collection"].extend(expansion_data_by_id[expansion_data["id"]]["accessories_collection"])


        games_collection = list(filter(lambda x: x["id"] in game_data_by_id, collection_by_id.values()))

        games = [
            BoardGame(
                game_data_by_id[collection["id"]],
                collection,
                expansions=[
                    BoardGame(expansion_data, collection)
                    for expansion_data in _uniq(game_data_by_id[collection["id"]]["expansions_collection"])
                    for collection in collection_by_id.getall(str(expansion_data["id"]))
                ],
                accessories=[
                    BoardGame(accessory_data, collection)
                    for accessory_data in _uniq(game_data_by_id[collection["id"]]["accessories_collection"])
                    for collection in accessory_collection_by_id.getall(str(accessory_data["id"]))
                ]
            )
            for collection in games_collection
        ]

        newGames = []

        games = filter_games_by_collection_id(games)

        # Cleanup the game
        for game in games:

            game = filter_unpublished_expansions(game)

            for exp in game.expansions:
                exp.name = remove_prefix(exp.name, game)
            for exp in game.wl_exp:
                exp.name = remove_prefix(exp.name, game)
            for exp in game.po_exp:
                exp.name = remove_prefix(exp.name, game)
            for acc in game.accessories:
                acc.name = remove_prefix(acc.name, game)
            for acc in game.wl_acc:
                acc.name = remove_prefix(acc.name, game)
            for acc in game.po_acc:
                acc.name = remove_prefix(acc.name, game)
            contained_list = []
            for con in game.contained:
                if con["inbound"]:
                    con["name"] = remove_prefix(con["name"], game)
                    contained_list.append(con)
            game.contained = sorted(contained_list, key=lambda x: x["name"])

            game.name = name_scrubber(game.name)

            integrates_list = []
            for integrate in game.integrates:
                # Filter integrates to owned games
                if str(integrate["id"]) in collection_by_id:
                    integrate["name"] = name_scrubber(integrate["name"])
                    integrates_list.append(integrate)
            game.integrates = sorted(integrates_list, key=lambda x: x["name"])

            for reimps in game.reimplements:
                reimps["name"] = name_scrubber(reimps["name"])
            for reimpby in game.reimplementedby:
                reimpby["name"] = name_scrubber(reimpby["name"])

            family_list = []
            for fam in game.families:
                newFam = family_filter(fam)
                if newFam:
                    family_list.append(newFam)
            game.families = family_list

            # TODO This is terrible, but split the extra expansions by letter
            if game.id == EXTRA_EXPANSIONS_GAME_ID:

                game.description = ""
                game.players = []
                for exp in game.expansions:
                    exp.players.clear()

                filterRegEx=r"^[j-qJ-Q]"
                newGame = copy.deepcopy(game)
                newGame.name = "ZZZ: Expansions without Game (J-Q)"
                newGame.collection_id = str(game.collection_id) + "2"

                newGame.expansions = list(filter(lambda x: re.search(filterRegEx, x.name), game.expansions))
                newGame.po_exp = list(filter(lambda x: re.search(filterRegEx, x.name), game.po_exp))
                newGame.wl_exp = list(filter(lambda x: re.search(filterRegEx, x.name), game.wl_exp))
                newGame.accessories = list(filter(lambda x: re.search(filterRegEx, x.name), game.accessories))
                newGame.po_acc = list(filter(lambda x: re.search(filterRegEx, x.name), game.po_acc))
                newGame.wl_acc = list(filter(lambda x: re.search(filterRegEx, x.name), game.wl_acc))

                newGame.expansions = sorted(newGame.expansions, key=lambda x: x.name)
                newGame.po_exp = sorted(newGame.po_exp, key=lambda x: x.name)
                newGame.wl_exp = sorted(newGame.wl_exp, key=lambda x: x.name)
                newGame.accessories = sorted(newGame.accessories, key=lambda x: x.name)
                newGame.po_acc = sorted(newGame.po_acc, key=lambda x: x.name)
                newGame.wl_acc = sorted(newGame.wl_acc, key=lambda x: x.name)

                game.expansions = list(set(game.expansions) - set(newGame.expansions))
                game.po_exp = list(set(game.po_exp) - set(newGame.po_exp))
                game.wl_exp = list(set(game.wl_exp) - set(newGame.wl_exp))
                game.accessories = list(set(game.accessories) - set(newGame.accessories))
                game.po_acc = list(set(game.po_acc) - set(newGame.po_acc))
                game.wl_acc = list(set(game.wl_acc) - set(newGame.wl_acc))

                newGames.append(newGame)

                filterRegEx=r"^[r-zR-Z]"
                newGame = copy.deepcopy(game)
                newGame.name = "ZZZ: Expansions without Game (R-Z)"
                newGame.collection_id = str(game.collection_id) + "3"

                newGame.expansions = list(filter(lambda x: re.search(filterRegEx, x.name), game.expansions))
                newGame.po_exp = list(filter(lambda x: re.search(filterRegEx, x.name), game.po_exp))
                newGame.wl_exp = list(filter(lambda x: re.search(filterRegEx, x.name), game.wl_exp))
                newGame.accessories = list(filter(lambda x: re.search(filterRegEx, x.name), game.accessories))
                newGame.po_acc = list(filter(lambda x: re.search(filterRegEx, x.name), game.po_acc))
                newGame.wl_acc = list(filter(lambda x: re.search(filterRegEx, x.name), game.wl_acc))

                newGame.expansions = sorted(newGame.expansions, key=lambda x: x.name)
                newGame.po_exp = sorted(newGame.po_exp, key=lambda x: x.name)
                newGame.wl_exp = sorted(newGame.wl_exp, key=lambda x: x.name)
                newGame.accessories = sorted(newGame.accessories, key=lambda x: x.name)
                newGame.po_acc = sorted(newGame.po_acc, key=lambda x: x.name)
                newGame.wl_acc = sorted(newGame.wl_acc, key=lambda x: x.name)

                game.expansions = list(set(game.expansions) - set(newGame.expansions))
                game.po_exp = list(set(game.po_exp) - set(newGame.po_exp))
                game.wl_exp = list(set(game.wl_exp) - set(newGame.wl_exp))
                game.accessories = list(set(game.accessories) - set(newGame.accessories))
                game.po_acc = list(set(game.po_acc) - set(newGame.po_acc))
                game.wl_acc = list(set(game.wl_acc) - set(newGame.wl_acc))

                newGames.append(newGame)

            # Resort the list after updating the names
            game.expansions = sorted(game.expansions, key=lambda x: x.name)
            game.po_exp = sorted(game.po_exp, key=lambda x: x.name)
            game.wl_exp = sorted(game.wl_exp, key=lambda x: x.name)
            game.accessories = sorted(game.accessories, key=lambda x: x.name)
            game.po_acc = sorted(game.po_acc, key=lambda x: x.name)
            game.wl_acc = sorted(game.wl_acc, key=lambda x: x.name)
            game.contained = sorted(game.contained, key=lambda x: x["name"])
            game.families = sorted(game.families, key=lambda x: x["name"])
            game.reimplements = sorted(game.reimplements, key=lambda x: x["name"])
            game.reimplementedby = sorted(game.reimplementedby, key=lambda x: x["name"])

        games.extend(newGames)

        return games

def _create_blank_collection(id, name):

    data = {
        "id": id,
        "name": name,
        "numplays": 0,
        "image": None,
        "image_version": None,
        "thumbnail": None,
        "thumbnail_version": None,
        "tags": ["own"],
        "comment": "",
        "wishlist_comment": "",
        "players": [],
        "version_name": "",
        "version_year": 0,
        "last_modified": "1970-01-01 00:00:00",
        "first_played": None,
        "last_played": None,
        "collection_id": id,
        "publisher_ids": [],
        "version_publisher": 0,
        "custom_version_year": 0,
    }

    return data

def _uniq(lst):
    lst = sorted(lst, key=lambda x: x['id'])
    for _, grp in itertools.groupby(lst, lambda d: (d['id'])):
        yield list(grp)[0]

def custom_accessories_mapping(accessories):

    acc_map = [
        # new Libertalia Coins can be used with the original version of the game
        {"id": 359371, "baseId": 125618},
        # They don't match in art, but GeekUp Bits can be used with new Amun-Re
        {"id": 283524, "baseId": 354568},
    ]

    for new_acc in acc_map:
        for acc in accessories:
            if new_acc["id"] == acc["id"]:
                acc["accessories"].append({"id": new_acc["baseId"], "inbound": True})

    return accessories

# This maps a specific game to the instance of Unpub to keep
# The game should also be mapped to Unpub expansion
# game.id : expansion.collection_id
unpub_map = {
    126042: 45853902,  # Nations
    177736: 66917665,  # A Feast for Odin,
    178550: 73699094,  # Spheres of influence
    319966: 89022895,  # King Is Dead
}

def filter_unpublished_expansions(game):
    """this will remove extra unpublished prototypes"""

    if game.id in unpub_map.keys():
        filtered_expansions = []
        for exp in game.wl_exp:  # look in WL because you can't own something that is Unpublished
            if exp.id == UNPUBLISHED_PROTOTYPE:
                if exp.collection_id == unpub_map[game.id]:
                    filtered_expansions.append(exp)
            else:
                filtered_expansions.append(exp)
        game.wl_exp = filtered_expansions

    return game

def filter_games_by_collection_id(games):
    """
    Filters a list of games by removing any game whose collection_id matches
    one of the values in the unpub_map.

    Args:
        games (list): A list of game dictionaries.

    Returns:
        list: The filtered list of games.
    """
    # Get all collection_ids from the unpub_map values
    collection_ids_to_filter = set(unpub_map.values())

    # Filter the games
    filtered_games = [
        game for game in games if game.collection_id not in collection_ids_to_filter
    ]

    return filtered_games

# TODO These mappings should be configurable
def custom_expansion_mappings(expansions):
    """add custom expansions mappings, because sometimes BGG is wrong"""

    exp_map = [
        # Original Tuscany should be an expansion for Viticulture Essential Edition (even if there is overlap)
        {"id": 147101, "baseId": 183394},
        # Viticulture Promo Cards to Viticulture EE
        {"id": 140045, "baseId": 183394},
        # Poison Expansion for Council of Verona
        {"id": 147827, "baseId": 165469},
        # Map the Carcassonne Map Chips to Carcassonne
        {"id": 291518, "baseId": 822},
        # Africa mapped to TtR: Europe
        {"id": 131188, "baseId": 14996},
        {"id": 131188, "baseId": 225244}, # TrR: Germany
        # Vegas Wits & Wager -> Wits & Wagers It's Vegas Baby
        {"id": 229967, "baseId": 286428},
        # Hive pocket includes these
        {"id": 30323, "baseId": 154597},
        {"id": 70704, "baseId": 154597},
        # Survive the Island Monster pack
        {"id": 436998, "baseId": 2653},
        # Kemet expansions to original version
        {"id": 313475, "baseId": 127023},
        {"id": 313480, "baseId": 127023},
        {"id": 313481, "baseId": 127023},
        # Sonar/Captain Sonar Expansions
        {"id": 206873, "baseId": 231819},
        {"id": 207122, "baseId": 231819},
        {"id": 207123, "baseId": 231819},
        {"id": 329903, "baseId": 231819},
        # Agricola Cards
        # {"id": 263965, "baseId": 31260},
        # Camel Up Cards Trophies in Camel UP
        {"id": 213282, "baseId": 153938},
        {"id": 213282, "baseId": 260605}, # Camel Up 2nd Edition

        # Unpublished Nations 2nd Expansion
        {"id": UNPUBLISHED_PROTOTYPE, "baseId": 126042},
        # Unpublished Feast for Odin Expansions
        {"id": UNPUBLISHED_PROTOTYPE, "baseId": 177736},
        # Unpublished Spheres of Influence
        {"id": UNPUBLISHED_PROTOTYPE, "baseId": 178550},
        # Unpublished King is Dead Vikings
        {"id": UNPUBLISHED_PROTOTYPE, "baseId": 319966},
    ]

    for exp in exp_map:
        expansions[exp["id"]]["expansions"].append({"id": exp["baseId"], "inbound": True})

    return expansions

# May want to make other changes to the family similar to the prefix logic
def family_filter(family):
    """Filter out Admin messages"""

    group = family["name"].split(":")[0]
    if group == "Admin":
        return None

    return family

def is_promo_box(game):
    """Ignore the Deutscher Spielepreile Goodie Boxes and Brettspiel Adventskalender as expansions and treat them like base games"""

    # Treat Knightmare Chess like a base game
    if game["id"] == 155192:
        return True

    # This is fixed. Mislabeled Marvel Zombies Promo Box, and Marvel/DC Unit Promo boxes - these shouldn't be labeled this way
    if game["id"] in (356731, 339182, 386892, 425907):
        return False

    # return game["id"] in (178656, 191779, 204573, 231506, 256951, 205611, 232298, 257590, 286086)
    # Change this to look for board game family 39378 (Box of Promos)
    return any(BOX_OF_PROMOS == family["id"] for family in game["families"])


articles = ['A', 'An', 'The']
def move_article_to_end(orig):
    """Move articles to the end of the title for proper title sorting"""

    if orig == None or orig == "":
        return orig

    new_title = orig
    title = new_title.split()
    if title[0] in articles:
        new_title = ' '.join(title[1:]) + ", " + title[0]

    return new_title

def move_article_to_start(orig):
    """Move the article back to the front for string comparison"""

    if orig == None or orig == "":
        return orig

    new_title = orig
    title = orig.split(", ")
    if title[-1] in articles:
        new_title = title[-1] + " " + ", ".join(title[:-1])
    return new_title

def name_scrubber(title):

    # Legendary
    new_title = re.sub(r"(Legendary(?: Encounters)?:) (?:An?)?\s*(.*) Deck Building Game",
                     r"\1 \2", title, flags=re.IGNORECASE)
    # Funkoverse
    new_title = re.sub(r"Funkoverse Strategy Game", "Funkoverse", new_title)

    new_title = move_article_to_end(new_title)

    if len(new_title) == 0:
        return title

    return new_title


def remove_prefix(expansion, game_details):
    """rules for cleaning up linked items to remove duplicate data, such as the title being repeated on every expansion"""

    new_exp = move_article_to_start(expansion)

    game_titles = game_details.alternate_names
    titles = [x.lower() for x in game_titles]
    titles.sort(key=len, reverse=True)

    new_exp_lower = new_exp.lower()
    for title in titles:
        if new_exp_lower == title:
            continue
        elif new_exp_lower.startswith(title) and not new_exp[len(title)].isalpha():
            new_exp = new_exp[len(title):]
            break

    #no_base_title = new_exp
    promoOnly = r"(\W*)Promo(?:tional)?(s?):?[\s-]*(?:(?:Box|Card|Deck|Pack|Set)(s?))?\s*(.*)"
    promo = re.match(promoOnly, new_exp)
    if promo:
        new_exp = new_exp + " [Promo]"
    else:
        # Relabel Promos
        new_exp = re.sub(r"(.*)s*Promo(?:tional)?(s?):?[\s-]*(?:(?:Box|Card|Deck|Pack|Set)(s?))?\s*(.*)",
                        r"\1 \4 [Promo\2\3]", new_exp, flags=re.IGNORECASE)

    # Expansions don't need to be labeled Expansion
    # TODO what about "Age of Expansion" or just "Expansion" (Legendary Encounters: Alien - Expansion)?
    # new_exp = re.sub(r"\s*(?:Mini|Micro)?[\s-]*Expansion\s*(?:Pack)?\s*", "", new_exp)
    # Fix consistency with different '-' being used.
    new_exp = re.sub(r"\–", "-", new_exp)
    # Pack sorting
    new_exp = re.sub(r"(.*)\s(Hero|Scenario|Ally|Villain|Mythos|Figure|Army|Faction|Investigator|Companion App) *(?:Starter|-)? +(?:Card|Deck|Pack|Set)\s*(#?\d*)", r"\2: \1", new_exp)
    # Scenarios
    new_exp = re.sub(r"(.*)\s(Scenario)s?\s*", r"\2: \1", new_exp)
    # Massive Darkness
    new_exp = re.sub(r"Heroes & Monster Set", "Hero Set", new_exp)
    # Heroic Bystanders
    new_exp = re.sub(r"(.*)\s*Heroic Bystander\s*(.*)", r"Heroic Bystander: \1\2", new_exp)
    # Marvel Masterpiece
    new_exp = re.sub(r"Marvel Masterpiece Trading Card:\s*(.*)", r"\1 [Alt Art]", new_exp)
    # Marvel Zombies
    new_exp = re.sub(r"(.*): A Zombicide Game", "\1", new_exp)
    # Brettspiel Adventskalender
    new_exp = re.sub(r"Brettspiel Adventskalender", "Brettspiel", new_exp, flags=re.IGNORECASE)
    # Welcome to...
    new_exp = re.sub(r"\s*Thematic Neighborhood", "", new_exp)
    # Thanos Risings
    new_exp = re.sub(r"Thanos Rising: Avengers Infinity War", "Thanos Rising", new_exp)
    # Barkham Horror
    new_exp = re.sub(r"Barkham Horror: The Card Game", "Barkham Horror", new_exp)
    # Isle of Skye
    new_exp = re.sub(r"Isle of Skye: From Chieftain to King", "Isle of Skye", new_exp)
    # Fleet: The Dice Game
    new_exp = re.sub(r"Second Edition\) \– ", "Second Edition ", new_exp)
    # Funkoverse
    new_exp = re.sub(r"Funkoverse Strategy Game", "Funkoverse", new_exp)
    # Shorten Fan Expansions to just [Fan]
    new_exp = re.sub(r"\s*\(?Fan expans.*", " [Fan]", new_exp, flags=re.IGNORECASE)
    # Ticket to Ride Map Collection Titles are too long
    new_exp = re.sub(r"\s*Map Collection: Volume ", "Map Pack ", new_exp, flags=re.IGNORECASE)
    # Remove leading whitespace and special characters
    new_exp = re.sub(r"^[^\w\"'`]+", "", new_exp)
    # Remove trailing special characters
    new_exp = re.sub(r"[\s,:-]+$", "", new_exp)
    # If there is still a dash (secondary delimiter), swap it to a colon
    new_exp = re.sub(r" \- ", ": ", new_exp)
    # Edge case where multiple ":" are in a row
    new_exp = re.sub(r"\s*:\s[:\s]*", ": ", new_exp)
    # extra space around (
    new_exp = re.sub(r"( [(/]) ", "\1", new_exp)

    new_exp = move_article_to_end(new_exp)

    # Lazy fix to move tags back to the end of the name
    new_exp = re.sub(r"( \[(?:Fan|Promo)\]), (.*)", r",\2\1", new_exp)

    # collapse any remaining multispaces
    new_exp = re.sub(r"/s/s+", " ", new_exp)

    # If we ended up removing everything - then just reset to what it started with
    if len(new_exp) == 0:
        return expansion
    # Also look for the case where the name is nothing but Promo
    # elif new_exp.startswith("Promo"):
    #     return expansion
    # elif new_exp.startswith("Wishlist"):
    #     return expansion
    # elif new_exp.startswith("Preorder"):
    #     return expansion

    return new_exp
