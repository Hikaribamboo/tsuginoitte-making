class_names = [
    "empty",
    "P",
    "L",
    "N",
    "S",
    "G",
    "B",
    "R",
    "K",
    "+P",
    "+L",
    "+N",
    "+S",
    "+B",
    "+R",
    "p",
    "l",
    "n",
    "s",
    "g",
    "b",
    "r",
    "k",
    "+p",
    "+l",
    "+n",
    "+s",
    "+b",
    "+r",
]

class_to_idx = {name: idx for idx, name in enumerate(class_names)}
idx_to_class = {idx: name for name, idx in class_to_idx.items()}


def class_dir_name(label: str) -> str:
    if label == "empty":
        return "empty"

    promoted = label.startswith("+")
    base = label[1:] if promoted else label
    side = "gote" if base.islower() else "sente"
    piece = base.upper()
    return f"{side}_{'promoted_' if promoted else ''}{piece}"


dir_name_to_class = {class_dir_name(label): label for label in class_names}
class_to_dir_name = {label: class_dir_name(label) for label in class_names}
